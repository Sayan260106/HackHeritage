import { OceanData, WeatherData } from '../../../src/types.ts';
import { buildTestRealtimeObservation } from './testRealtimeProvider.ts';

const WEATHER_API_URL = process.env.OPEN_METEO_WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast';
const MARINE_API_URL = process.env.OPEN_METEO_MARINE_API_URL || 'https://marine-api.open-meteo.com/v1/marine';
const REQUEST_TIMEOUT_MS = Number(process.env.REALTIME_DATA_TIMEOUT_MS || 15000);

interface OpenMeteoCurrentWeather {
  time?: string;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  precipitation?: number;
  weather_code?: number;
  surface_pressure?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  visibility?: number;
  cloud_cover?: number;
}
interface OpenMeteoWeatherResponse { current?: OpenMeteoCurrentWeather; }
interface OpenMeteoCurrentMarine {
  time?: string;
  wave_height?: number;
  wave_direction?: number;
  wave_period?: number;
  swell_wave_height?: number;
  swell_wave_direction?: number;
  swell_wave_period?: number;
  sea_surface_temperature?: number;
  ocean_current_velocity?: number;
  ocean_current_direction?: number;
  sea_level_height_msl?: number;
}
interface OpenMeteoMarineResponse { current?: OpenMeteoCurrentMarine; daily?: { wave_height_max?: number[] }; }

function compass(degrees: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.floor((degrees + 11.25) / 22.5) % 16];
}
function requiredNumber(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`Open-Meteo returned no valid ${field}.`);
  return number;
}
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return response.json() as Promise<T>;
}

export async function fetchOpenMeteoCurrent(lat: number, lon: number): Promise<{ weather: WeatherData; ocean: OceanData; retrievedAt: string }> {
  if (process.env.ORCA_REALTIME_TEST_MODE === 'fixture') {
    const fixture = buildTestRealtimeObservation(lat, lon);
    return { weather: fixture.weather!, ocean: fixture.ocean!, retrievedAt: fixture.retrievedAt };
  }

  const weatherParams = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover', wind_speed_unit: 'kn', timezone: 'auto' });
  const marineParams = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl', daily: 'wave_height_max', timezone: 'auto' });
  const retrievedAt = new Date().toISOString();
  const [weatherResponse, marineResponse] = await Promise.all([
    fetchJson<OpenMeteoWeatherResponse>(`${WEATHER_API_URL}?${weatherParams.toString()}`),
    fetchJson<OpenMeteoMarineResponse>(`${MARINE_API_URL}?${marineParams.toString()}`),
  ]);
  const currentW = weatherResponse.current;
  const currentM = marineResponse.current;
  if (!currentW) throw new Error('Open-Meteo weather response did not contain current conditions.');
  if (!currentM) throw new Error('Open-Meteo marine response did not contain current conditions.');

  const windSpeedKts = requiredNumber(currentW.wind_speed_10m, 'wind speed');
  const windGustKts = requiredNumber(currentW.wind_gusts_10m, 'wind gusts');
  const windDirectionDeg = requiredNumber(currentW.wind_direction_10m, 'wind direction');
  const waveHeight = requiredNumber(currentM.wave_height, 'wave height');
  const wavePeriod = requiredNumber(currentM.wave_period, 'wave period');
  const swellHeight = requiredNumber(currentM.swell_wave_height, 'swell wave height');
  const swellPeriod = requiredNumber(currentM.swell_wave_period, 'swell wave period');
  const currentVelocityKmh = requiredNumber(currentM.ocean_current_velocity, 'ocean current velocity');
  const currentDirectionDeg = requiredNumber(currentM.ocean_current_direction, 'ocean current direction');
  const sst = requiredNumber(currentM.sea_surface_temperature, 'sea surface temperature');
  const waveDirection = requiredNumber(currentM.wave_direction, 'wave direction');
  const swellDirection = requiredNumber(currentM.swell_wave_direction, 'swell wave direction');
  const seaLevel = requiredNumber(currentM.sea_level_height_msl, 'sea level height');
  const dailyMaxWave = marineResponse.daily?.wave_height_max?.[0];
  const observedWeatherAt = currentW.time || retrievedAt;
  const observedMarineAt = currentM.time || retrievedAt;
  let seaStateIndex = 1;
  let seaStateDescription = 'Calm to Smooth (< 0.5m)';
  if (waveHeight >= 4) { seaStateIndex = 6; seaStateDescription = 'Very Rough to High (> 4.0m)'; }
  else if (waveHeight >= 2.5) { seaStateIndex = 5; seaStateDescription = 'Rough (Wave 2.5 - 4.0m)'; }
  else if (waveHeight >= 1.25) { seaStateIndex = 4; seaStateDescription = 'Moderate (Wave 1.25 - 2.5m)'; }
  else if (waveHeight >= 0.5) { seaStateIndex = 3; seaStateDescription = 'Slight (Wave 0.5 - 1.25m)'; }

  const weather: WeatherData = {
    airTemperatureC: requiredNumber(currentW.temperature_2m, 'air temperature'), windSpeedKts: Number(windSpeedKts.toFixed(1)), windGustKts: Number(windGustKts.toFixed(1)), windDirectionDeg, windDirectionCompass: compass(windDirectionDeg), precipitationMm: requiredNumber(currentW.precipitation, 'precipitation'), cloudCoverPct: requiredNumber(currentW.cloud_cover, 'cloud cover'), visibilityKm: Number((requiredNumber(currentW.visibility, 'visibility') / 1000).toFixed(1)), pressureHpa: requiredNumber(currentW.surface_pressure, 'surface pressure'), weatherCode: requiredNumber(currentW.weather_code, 'weather code'), weatherDescription: `Open-Meteo WMO weather code ${currentW.weather_code}`, source: 'Open-Meteo Weather API', sourceUrl: WEATHER_API_URL, observedAt: observedWeatherAt, retrievedAt, dataQuality: 'LIVE',
  };
  const ocean: OceanData = {
    waveHeightMeters: Number(waveHeight.toFixed(2)), maxWaveHeightMeters: Number((typeof dailyMaxWave === 'number' ? dailyMaxWave : waveHeight).toFixed(2)), wavePeriodSec: Number(wavePeriod.toFixed(1)), waveDirectionDeg: Number(waveDirection.toFixed(1)), swellHeightMeters: Number(swellHeight.toFixed(2)), swellPeriodSec: Number(swellPeriod.toFixed(1)), swellDirectionDeg: Number(swellDirection.toFixed(1)), seaSurfaceTemperatureC: Number(sst.toFixed(1)), currentSpeedKts: Number((currentVelocityKmh * 0.539957).toFixed(2)), currentDirectionDeg: Number(currentDirectionDeg.toFixed(1)), seaStateIndex, seaStateDescription, tidePhase: 'Unknown', tideHeightMeters: Number(seaLevel.toFixed(2)), source: 'Open-Meteo Marine API', sourceUrl: MARINE_API_URL, observedAt: observedMarineAt, retrievedAt, dataQuality: 'LIVE',
  };
  return { weather, ocean, retrievedAt };
}
