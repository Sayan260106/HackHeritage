import type { OceanData, WeatherData } from '../../../src/types.ts';
import type { MarineSourceObservation } from './marineDataSource.ts';
import type { OpenMeteoForecastPoint } from './openMeteoForecastProvider.ts';

function compass(degrees: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.floor((degrees + 11.25) / 22.5) % 16];
}

export function buildTestRealtimeObservation(lat: number, lon: number): MarineSourceObservation {
  const retrievedAt = new Date().toISOString();
  const weather: WeatherData = {
    airTemperatureC: 28,
    windSpeedKts: 14,
    windGustKts: 20,
    windDirectionDeg: 90,
    windDirectionCompass: compass(90),
    precipitationMm: 0,
    cloudCoverPct: 35,
    visibilityKm: 10,
    pressureHpa: 1010,
    weatherCode: 2,
    weatherDescription: 'Deterministic CI realtime fixture',
    source: 'ORCA-X CI realtime fixture',
    sourceUrl: 'ci://realtime-fixture',
    observedAt: retrievedAt,
    retrievedAt,
    dataQuality: 'LIVE',
  };

  const ocean: OceanData = {
    waveHeightMeters: 0.9,
    maxWaveHeightMeters: 1.4,
    wavePeriodSec: 5,
    waveDirectionDeg: 90,
    swellHeightMeters: 0.5,
    swellPeriodSec: 7,
    swellDirectionDeg: 90,
    seaSurfaceTemperatureC: 28,
    currentSpeedKts: 0.6,
    currentDirectionDeg: 90,
    seaStateIndex: 3,
    seaStateDescription: 'Slight',
    tidePhase: 'Unknown',
    tideHeightMeters: 0,
    source: 'ORCA-X CI realtime fixture',
    sourceUrl: 'ci://realtime-fixture',
    observedAt: retrievedAt,
    retrievedAt,
    dataQuality: 'LIVE',
  };

  return {
    source: 'TEST_FIXTURE',
    weather,
    ocean,
    observedAt: retrievedAt,
    retrievedAt,
    availability: 'LIVE',
    qualityScore: 1,
    warnings: [`Deterministic CI fixture used for realtime integration testing at ${lat.toFixed(4)},${lon.toFixed(4)}; production never enables this source.`],
  };
}

export function buildTestForecast(lat: number, lon: number): {
  points: OpenMeteoForecastPoint[];
  forecastDate: string;
  retrievedAt: string;
  timezone: string;
} {
  const retrievedAt = new Date().toISOString();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(0, 0, 0, 0);
  const points: OpenMeteoForecastPoint[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const forecastAt = new Date(start.getTime() + hour * 3600000).toISOString();
    const currentWeather = buildTestRealtimeObservation(lat, lon);
    const weather = { ...currentWeather.weather!, observedAt: forecastAt, retrievedAt, source: 'ORCA-X CI forecast fixture', sourceUrl: 'ci://forecast-fixture' };
    const ocean = { ...currentWeather.ocean!, observedAt: forecastAt, retrievedAt, source: 'ORCA-X CI forecast fixture', sourceUrl: 'ci://forecast-fixture' };
    points.push({ forecastAt, weather, ocean });
  }

  return {
    points,
    forecastDate: start.toISOString().slice(0, 10),
    retrievedAt,
    timezone: 'UTC',
  };
}
