import type { MarineObservationSource, MarineSourceObservation, FusedMarineObservation, MarineSourceId } from './marineDataSource.ts';
import type { MarineObservationVariable } from './marineObservation.ts';
import { incoisErddapProvider } from './incoisErddapProvider.ts';
import { mosdacCacheProvider } from './mosdacCacheProvider.ts';
import { fetchOpenMeteoCurrent } from './openMeteoProvider.ts';
import { compareSources } from './sourceComparison.ts';
import { normalizeMarineObservation } from './marineObservation.ts';
import { recordMarineTelemetry } from './marineTelemetry.ts';

const OPEN_METEO_PRIORITY = 50;
const MAX_STALENESS_HOURS = Number(process.env.REALTIME_MAX_STALENESS_HOURS || 3);
const VARIABLE_NAMES: MarineObservationVariable[] = [
  'windSpeedKts', 'windGustKts', 'windDirectionDeg',
  'waveHeightMeters', 'wavePeriodSec', 'waveDirectionDeg',
  'swellHeightMeters', 'swellPeriodSec', 'swellDirectionDeg',
  'seaSurfaceTemperatureC', 'currentSpeedKts', 'currentDirectionDeg',
  'airTemperatureC', 'precipitationMm', 'pressureHpa', 'visibilityKm',
];

async function openMeteoSource(lat: number, lon: number): Promise<MarineSourceObservation> {
  try {
    const result = await fetchOpenMeteoCurrent(lat, lon);
    return {
      source: 'OPEN_METEO', weather: result.weather, ocean: result.ocean,
      observedAt: result.weather.observedAt, retrievedAt: result.retrievedAt,
      availability: 'LIVE', warnings: [], qualityScore: 1,
    };
  } catch (error) {
    return {
      source: 'OPEN_METEO', observedAt: new Date(0).toISOString(), retrievedAt: new Date().toISOString(),
      availability: 'DEGRADED', warnings: [`Open-Meteo request failed: ${error instanceof Error ? error.message : String(error)}`], qualityScore: 0,
    };
  }
}

const configuredProviders = (): MarineObservationSource[] => [
  incoisErddapProvider,
  mosdacCacheProvider,
  { id: 'OPEN_METEO', displayName: 'Open-Meteo', priority: OPEN_METEO_PRIORITY, enabled: true, fetch: openMeteoSource },
];

function unavailable(source: MarineObservationSource): MarineSourceObservation {
  return {
    source: source.id,
    observedAt: new Date(0).toISOString(),
    retrievedAt: new Date().toISOString(),
    availability: 'UNAVAILABLE',
    warnings: [`${source.displayName} is disabled; no network request was made.`],
    qualityScore: 0,
  };
}

function providerPriority(source: MarineSourceId): number {
  return configuredProviders().find((provider) => provider.id === source)?.priority || 0;
}

function variableScore(source: ReturnType<typeof normalizeMarineObservation>): number {
  if (source.availability !== 'LIVE' || !Number.isFinite(source.ageHours) || source.ageHours > MAX_STALENESS_HOURS) return 0;
  return Number((0.75 * source.freshnessScore + 0.15 + providerPriority(source.source) / 1000).toFixed(4));
}

function pickBaseSources(normalizedSources: ReturnType<typeof normalizeMarineObservation>[]) {
  let usable = normalizedSources.filter((source) => source.ageHours <= MAX_STALENESS_HOURS && source.availability === 'LIVE');
  if (usable.length === 0) {
    usable = normalizedSources.filter((source) => source.weather || source.ocean);
  }
  const withWeather = [...usable.filter((source) => source.weather)].sort((a, b) => b.qualityScore - a.qualityScore);
  const withOcean = [...usable.filter((source) => source.ocean)].sort((a, b) => b.qualityScore - a.qualityScore);
  return {
    weather: withWeather[0]?.weather,
    weatherSource: withWeather[0]?.source,
    ocean: withOcean[0]?.ocean,
    oceanSource: withOcean[0]?.source,
  };
}

export function getRealtimeSourceReadiness() {
  return configuredProviders().map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    enabled: provider.enabled,
    priority: provider.priority,
    configured: provider.enabled,
  }));
}

export async function fetchFusedRealtimeMarineObservation(lat: number, lon: number): Promise<FusedMarineObservation> {
  const providers = configuredProviders();
  const rawObservations = await Promise.all(providers.map((provider) => provider.enabled ? provider.fetch(lat, lon) : Promise.resolve(unavailable(provider))));
  const retrievedAt = new Date().toISOString();
  const normalizedSources = rawObservations.map((source) => normalizeMarineObservation(
    source.source, source.availability, lat, lon, source.observedAt,
    source.retrievedAt || retrievedAt, source.weather, source.ocean,
    source.warnings, source.values,
  ));

  const ranked = normalizedSources.map((source) => ({ source, score: variableScore(source) }));
  const base = pickBaseSources(normalizedSources);

  if (!base.weather || !base.ocean) {
    try {
      const direct = await fetchOpenMeteoCurrent(lat, lon);
      if (!base.weather) base.weather = direct.weather;
      if (!base.ocean) base.ocean = direct.ocean;
    } catch {
      // Keep going if base already has partial
    }
  }
  if (!base.weather || !base.ocean) throw new Error('No complete real-time weather and ocean observation is available for ML inference.');

  const featureSources: Partial<Record<MarineObservationVariable, MarineSourceId>> = {};
  const fusedWeather = { ...base.weather };
  const fusedOcean = { ...base.ocean };

  for (const variable of VARIABLE_NAMES) {
    const selected = ranked
      .filter((entry) => entry.score > 0 && Number.isFinite(entry.source.values[variable]))
      .sort((a, b) => b.score - a.score || providerPriority(b.source.source) - providerPriority(a.source.source))[0];
    if (!selected) continue;
    const value = selected.source.values[variable]!;
    featureSources[variable] = selected.source.source;
    switch (variable) {
      case 'windSpeedKts': fusedWeather.windSpeedKts = value; break;
      case 'windGustKts': fusedWeather.windGustKts = value; break;
      case 'windDirectionDeg': fusedWeather.windDirectionDeg = value; break;
      case 'airTemperatureC': fusedWeather.airTemperatureC = value; break;
      case 'precipitationMm': fusedWeather.precipitationMm = value; break;
      case 'pressureHpa': fusedWeather.pressureHpa = value; break;
      case 'visibilityKm': fusedWeather.visibilityKm = value; break;
      case 'waveHeightMeters': fusedOcean.waveHeightMeters = value; break;
      case 'wavePeriodSec': fusedOcean.wavePeriodSec = value; break;
      case 'waveDirectionDeg': fusedOcean.waveDirectionDeg = value; break;
      case 'swellHeightMeters': fusedOcean.swellHeightMeters = value; break;
      case 'swellPeriodSec': fusedOcean.swellPeriodSec = value; break;
      case 'swellDirectionDeg': fusedOcean.swellDirectionDeg = value; break;
      case 'seaSurfaceTemperatureC': fusedOcean.seaSurfaceTemperatureC = value; break;
      case 'currentSpeedKts': fusedOcean.currentSpeedKts = value; break;
      case 'currentDirectionDeg': fusedOcean.currentDirectionDeg = value; break;
    }
  }

  const waveHeight = fusedOcean.waveHeightMeters;
  fusedOcean.seaStateIndex = waveHeight >= 4 ? 6 : waveHeight >= 2.5 ? 5 : waveHeight >= 1.25 ? 4 : waveHeight >= 0.5 ? 3 : 1;
  fusedOcean.seaStateDescription = waveHeight >= 4 ? 'Very Rough to High (> 4.0m)' : waveHeight >= 2.5 ? 'Rough (Wave 2.5 - 4.0m)' : waveHeight >= 1.25 ? 'Moderate (Wave 1.25 - 2.5m)' : waveHeight >= 0.5 ? 'Slight (Wave 0.5 - 1.25m)' : 'Calm to Smooth (< 0.5m)';
  fusedWeather.source = `ORCA-X variable fusion (${base.weatherSource || 'OPEN_METEO'} base)`;
  fusedOcean.source = `ORCA-X variable fusion (${base.oceanSource || 'OPEN_METEO'} base)`;
  fusedWeather.retrievedAt = retrievedAt;
  fusedOcean.retrievedAt = retrievedAt;

  const selectedSources: Record<string, MarineSourceId> = {
    weather: base.weatherSource || 'OPEN_METEO',
    ocean: base.oceanSource || 'OPEN_METEO',
  };
  const sourceScores = Object.fromEntries(ranked.map((entry) => [entry.source.source, entry.score])) as Record<MarineSourceId, number>;
  const comparison = compareSources(normalizedSources);
  const disagreementWarnings = comparison.filter((metric) => metric.disagreement).map((metric) => `Source disagreement detected for ${metric.variable} (${((metric.relativeSpread || 0) * 100).toFixed(0)}% relative spread).`);
  const validationWarnings = normalizedSources.flatMap((source) => source.missingVariables.length > 0 ? [`${source.source}: ${source.missingVariables.length} normalized variables are missing.`] : []);
  const warnings = [...new Set([...normalizedSources.flatMap((source) => source.warnings), ...validationWarnings, ...disagreementWarnings])];
  const liveSources = [...new Set(ranked.filter((entry) => entry.score > 0).map((entry) => entry.source.source))];
  const dataQuality = liveSources.length >= 2 ? 'LIVE' : liveSources.length === 1 ? 'DEGRADED' : 'UNAVAILABLE';
  const fusedValues: Partial<Record<MarineObservationVariable, number>> = {};
  for (const variable of VARIABLE_NAMES) {
    const value = variable === 'windSpeedKts' ? fusedWeather.windSpeedKts
      : variable === 'windGustKts' ? fusedWeather.windGustKts
      : variable === 'windDirectionDeg' ? fusedWeather.windDirectionDeg
      : variable === 'airTemperatureC' ? fusedWeather.airTemperatureC
      : variable === 'precipitationMm' ? fusedWeather.precipitationMm
      : variable === 'pressureHpa' ? fusedWeather.pressureHpa
      : variable === 'visibilityKm' ? fusedWeather.visibilityKm
      : variable === 'waveHeightMeters' ? fusedOcean.waveHeightMeters
      : variable === 'wavePeriodSec' ? fusedOcean.wavePeriodSec
      : variable === 'waveDirectionDeg' ? fusedOcean.waveDirectionDeg
      : variable === 'swellHeightMeters' ? fusedOcean.swellHeightMeters
      : variable === 'swellPeriodSec' ? fusedOcean.swellPeriodSec
      : variable === 'swellDirectionDeg' ? fusedOcean.swellDirectionDeg
      : variable === 'seaSurfaceTemperatureC' ? fusedOcean.seaSurfaceTemperatureC
      : variable === 'currentSpeedKts' ? fusedOcean.currentSpeedKts
      : fusedOcean.currentDirectionDeg;
    if (typeof value === 'number' && Number.isFinite(value)) fusedValues[variable] = value;
  }

  recordMarineTelemetry({
    timestamp: retrievedAt, latitude: lat, longitude: lon,
    sources: normalizedSources.map((source) => ({
      source: source.source, availability: source.availability, observedAt: source.observedAt,
      ageHours: Number.isFinite(source.ageHours) ? Number(source.ageHours.toFixed(3)) : source.ageHours,
      freshnessScore: source.freshnessScore, completenessScore: source.completenessScore,
      qualityScore: source.qualityScore, missingVariables: source.missingVariables,
      values: source.values, warningCount: source.warnings.length,
    })),
    fusedValues,
    featureSources,
    selectedSources,
    sourceScores,
    dataQuality,
    disagreements: comparison.filter((metric) => metric.disagreement).map((metric) => ({ variable: metric.variable, spread: metric.spread || 0 })),
    warnings,
  });

  return {
    weather: fusedWeather,
    ocean: fusedOcean,
    normalizedSources,
    selectedSources,
    featureSources,
    sourceScores,
    providers: liveSources,
    warnings,
    dataQuality,
    retrievedAt,
  };
}
