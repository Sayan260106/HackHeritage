import type { OceanData, WeatherData } from '../../../src/types.ts';
import type { MarineSourceId, SourceAvailability } from './marineDataSource.ts';

export type MarineObservationVariable =
  | 'windSpeedKts'
  | 'windGustKts'
  | 'windDirectionDeg'
  | 'waveHeightMeters'
  | 'wavePeriodSec'
  | 'waveDirectionDeg'
  | 'swellHeightMeters'
  | 'swellPeriodSec'
  | 'swellDirectionDeg'
  | 'seaSurfaceTemperatureC'
  | 'currentSpeedKts'
  | 'currentDirectionDeg'
  | 'airTemperatureC'
  | 'precipitationMm'
  | 'pressureHpa'
  | 'visibilityKm';

export interface MarineObservation {
  source: MarineSourceId;
  availability: SourceAvailability;
  latitude: number;
  longitude: number;
  observedAt: string;
  retrievedAt: string;
  ageHours: number;
  freshnessScore: number;
  completenessScore: number;
  qualityScore: number;
  weather?: WeatherData;
  ocean?: OceanData;
  values: Partial<Record<MarineObservationVariable, number>>;
  missingVariables: MarineObservationVariable[];
  warnings: string[];
}

const VARIABLES: MarineObservationVariable[] = [
  'windSpeedKts', 'windGustKts', 'windDirectionDeg',
  'waveHeightMeters', 'wavePeriodSec', 'waveDirectionDeg',
  'swellHeightMeters', 'swellPeriodSec', 'swellDirectionDeg',
  'seaSurfaceTemperatureC', 'currentSpeedKts', 'currentDirectionDeg',
  'airTemperatureC', 'precipitationMm', 'pressureHpa', 'visibilityKm',
];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function valuesFromPayload(
  weather?: WeatherData,
  ocean?: OceanData,
  providerValues: Partial<Record<MarineObservationVariable, number>> = {},
): Partial<Record<MarineObservationVariable, number>> {
  const values: Partial<Record<MarineObservationVariable, number>> = {};
  const weatherValues: Partial<Record<MarineObservationVariable, number>> = weather ? {
    windSpeedKts: weather.windSpeedKts,
    windGustKts: weather.windGustKts,
    windDirectionDeg: weather.windDirectionDeg,
    airTemperatureC: weather.airTemperatureC,
    precipitationMm: weather.precipitationMm,
    pressureHpa: weather.pressureHpa,
    visibilityKm: weather.visibilityKm,
  } : {};
  const oceanValues: Partial<Record<MarineObservationVariable, number>> = ocean ? {
    waveHeightMeters: ocean.waveHeightMeters,
    wavePeriodSec: ocean.wavePeriodSec,
    waveDirectionDeg: ocean.waveDirectionDeg,
    swellHeightMeters: ocean.swellHeightMeters,
    swellPeriodSec: ocean.swellPeriodSec,
    swellDirectionDeg: ocean.swellDirectionDeg,
    seaSurfaceTemperatureC: ocean.seaSurfaceTemperatureC,
    currentSpeedKts: ocean.currentSpeedKts,
    currentDirectionDeg: ocean.currentDirectionDeg,
  } : {};
  for (const [key, value] of Object.entries({ ...weatherValues, ...oceanValues, ...providerValues })) {
    if (finite(value)) values[key as MarineObservationVariable] = value;
  }
  return values;
}

export function normalizeMarineObservation(
  source: MarineSourceId,
  availability: SourceAvailability,
  latitude: number,
  longitude: number,
  observedAt: string,
  retrievedAt: string,
  weather?: WeatherData,
  ocean?: OceanData,
  warnings: string[] = [],
  providerValues: Partial<Record<MarineObservationVariable, number>> = {},
): MarineObservation {
  const now = Date.parse(retrievedAt);
  const observed = Date.parse(observedAt);
  const ageHours = Number.isFinite(now) && Number.isFinite(observed)
    ? Math.max(0, (now - observed) / 3_600_000)
    : Number.POSITIVE_INFINITY;
  const values = valuesFromPayload(weather, ocean, providerValues);
  const present = Object.keys(values).length;
  const completenessScore = present / VARIABLES.length;
  const freshnessScore = Number.isFinite(ageHours) ? Math.max(0, 1 - Math.min(ageHours, 3) / 3) : 0;
  const availabilityScore = availability === 'LIVE' ? 1 : availability === 'DEGRADED' ? 0.5 : 0;
  const qualityScore = Number((0.55 * freshnessScore + 0.30 * completenessScore + 0.15 * availabilityScore).toFixed(4));
  const missingVariables = VARIABLES.filter((variable) => !finite(values[variable]));

  return {
    source,
    availability,
    latitude,
    longitude,
    observedAt,
    retrievedAt,
    ageHours,
    freshnessScore,
    completenessScore,
    qualityScore,
    weather,
    ocean,
    values,
    missingVariables,
    warnings,
  };
}
