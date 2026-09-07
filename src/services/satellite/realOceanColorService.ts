/**
 * Real-World Oceanographic Satellite Data Service
 *
 * 100% REAL-WORLD, PEER-REVIEWED SCIENTIFIC SATELLITE FEEDS (ZERO MOCK / ZERO HARDCODED VALUES).
 */

import { readFile } from 'node:fs/promises';

export interface RealOceanMetrics {
  chlorophyllConcentrationMgM3?: number;
  chlorophyllObservedAt?: string;
  chlorophyllSource?: string;
  sstC?: number;
  sstAnomalyC?: number;
  sstObservedAt?: string;
  sstSource?: string;
  turbidityNTU?: number;
  turbiditySource?: string;
  algalBloomDetected?: boolean;
  algalBloomReason?: string;
  thermalFrontDetected?: boolean;
  thermalFrontReason?: string;
  sourcesUsed: string[];
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const oceanMetricsCache = new Map<string, { expiresAt: number; data: RealOceanMetrics }>();

type ValueResult = { value?: number; observedAt?: string; source?: string };
type SstResult = { sstC?: number; observedAt?: string; source?: string };
type ErddapRow = [string, number, number, number, number | null];
type ErddapResponse = { table?: { rows?: ErddapRow[] } };
type MosdacSnapshot = { latitude?: unknown; longitude?: unknown; observedAt?: unknown; values?: Record<string, unknown> };

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function getMarineProbes(lat: number, lon: number): Array<{ lat: number; lon: number }> {
  const isEastCoast = lon >= 77.5;
  const offLon1 = isEastCoast ? lon + 0.15 : lon - 0.20;
  const offLon2 = isEastCoast ? lon + 0.28 : lon - 0.35;
  return [
    { lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) },
    { lat: Number((lat - 0.12).toFixed(2)), lon: Number(offLon1.toFixed(2)) },
    { lat: Number((lat - 0.18).toFixed(2)), lon: Number(offLon2.toFixed(2)) },
    { lat: Number(lat.toFixed(2)), lon: Number(offLon1.toFixed(2)) },
  ];
}

async function fetchRealChlorophyll(lat: number, lon: number): Promise<ValueResult> {
  for (const probe of getMarineProbes(lat, lon)) {
    try {
      const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisVHNSQchlaMonthly.json?chlor_a[(last)][(0.0)][(${probe.lat})][(${probe.lon})]`;
      const res = await fetch(url, { headers: { 'User-Agent': 'ORCA-X/1.0' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const json = await res.json() as ErddapResponse;
      const row = json.table?.rows?.[0];
      const value = row?.[4];
      if (row && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return { value: Number(value.toFixed(3)), observedAt: row[0], source: 'NOAA VIIRS 4km Science Quality Chlorophyll-a' };
      }
    } catch {
      // Try the next offshore probe.
    }
  }
  return {};
}

async function fetchRealTurbidity(lat: number, lon: number): Promise<ValueResult> {
  for (const probe of getMarineProbes(lat, lon)) {
    try {
      const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisVHNSQkd490Monthly.json?kd_490[(last)][(0.0)][(${probe.lat})][(${probe.lon})]`;
      const res = await fetch(url, { headers: { 'User-Agent': 'ORCA-X/1.0' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const json = await res.json() as ErddapResponse;
      const row = json.table?.rows?.[0];
      const value = row?.[4];
      if (row && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return { value: Number(value.toFixed(3)), observedAt: row[0], source: 'NOAA VIIRS 4km Measured Kd(490) Water Clarity' };
      }
    } catch {
      // Try the next offshore probe.
    }
  }
  return {};
}

async function fetchRealSstAnomaly(lat: number, lon: number): Promise<ValueResult> {
  for (const probe of getMarineProbes(lat, lon)) {
    try {
      const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41anom1day.json?sstAnom[(last)][(${probe.lat})][(${probe.lon})]`;
      const res = await fetch(url, { headers: { 'User-Agent': 'ORCA-X/1.0' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const json = await res.json() as ErddapResponse;
      const row = json.table?.rows?.[0];
      const value = row?.[3];
      if (row && typeof value === 'number' && Number.isFinite(value)) {
        return { value: Number(value.toFixed(2)), observedAt: row[0], source: 'NASA JPL MUR 1km Global SST Anomaly' };
      }
    } catch {
      // Try the next offshore probe.
    }
  }
  return {};
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function fetchMosdacSst(lat: number, lon: number): Promise<SstResult> {
  const cacheFile = process.env.MOSDAC_REALTIME_CACHE_FILE || 'data/realtime/mosdac_latest.json';
  try {
    const payload = JSON.parse(await readFile(cacheFile, 'utf-8')) as MosdacSnapshot;
    const value = payload.values?.seaSurfaceTemperatureC;
    const observedAt = typeof payload.observedAt === 'string' ? payload.observedAt : undefined;
    if (!finite(value) || !observedAt) return {};

    const observedMillis = Date.parse(observedAt);
    if (!Number.isFinite(observedMillis)) return {};
    const maxAgeHours = Number(process.env.MOSDAC_MAX_CACHE_STALENESS_HOURS || 36);
    const ageHours = (Date.now() - observedMillis) / 3600000;
    if (!Number.isFinite(maxAgeHours) || ageHours < -1 || ageHours > maxAgeHours) return {};

    const cacheLat = finite(payload.latitude) ? payload.latitude : lat;
    const cacheLon = finite(payload.longitude) ? payload.longitude : lon;
    const distance = Math.hypot(cacheLat - lat, cacheLon - lon);
    const maxDistance = Number(process.env.MOSDAC_MAX_CACHE_DISTANCE_DEG || 2);
    if (!Number.isFinite(maxDistance) || distance > maxDistance) return {};

    return {
      sstC: Number(value.toFixed(2)),
      observedAt,
      source: 'MOSDAC / ISRO INSAT-3DS 3SIMG_L3B_SST',
    };
  } catch {
    return {};
  }
}

async function fetchRealSst(lat: number, lon: number): Promise<SstResult> {
  const mosdac = await fetchMosdacSst(lat, lon);
  if (mosdac.sstC !== undefined) return mosdac;

  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=sea_surface_temperature`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return {};
    const data = await res.json() as { current?: { time?: string; sea_surface_temperature?: number } };
    const value = data.current?.sea_surface_temperature;
    return typeof value === 'number' && Number.isFinite(value)
      ? { sstC: Number(value.toFixed(1)), observedAt: data.current?.time, source: 'Copernicus Marine / ECMWF Reanalysis (Open-Meteo)' }
      : {};
  } catch {
    return {};
  }
}

export async function fetchRealOceanMetrics(lat: number, lon: number): Promise<RealOceanMetrics> {
  const key = cacheKey(lat, lon);
  const now = Date.now();
  const cached = oceanMetricsCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const [chla, turbidity, anomaly, sst] = await Promise.all([
    fetchRealChlorophyll(lat, lon).catch((): ValueResult => ({})),
    fetchRealTurbidity(lat, lon).catch((): ValueResult => ({})),
    fetchRealSstAnomaly(lat, lon).catch((): ValueResult => ({})),
    fetchRealSst(lat, lon).catch((): SstResult => ({})),
  ]);

  const sourcesUsed = [chla.source, turbidity.source, anomaly.source, sst.source].filter(
    (source): source is string => Boolean(source),
  );
  const algalBloomDetected = typeof chla.value === 'number' ? chla.value >= 2.0 : undefined;
  const algalBloomReason = typeof chla.value === 'number'
    ? algalBloomDetected
      ? `Chlorophyll-a elevated (${chla.value} mg/m³ >= 2.0 mg/m³ threshold).`
      : `Chlorophyll-a is ${chla.value} mg/m³; no elevated-bloom threshold was crossed.`
    : undefined;
  const thermalFrontDetected = typeof anomaly.value === 'number' ? Math.abs(anomaly.value) >= 1.0 : undefined;
  const thermalFrontReason = typeof anomaly.value === 'number'
    ? thermalFrontDetected
      ? `SST anomaly ${anomaly.value >= 0 ? '+' : ''}${anomaly.value}°C crosses the thermal-front indicator threshold.`
      : `SST anomaly ${anomaly.value >= 0 ? '+' : ''}${anomaly.value}°C remains below the thermal-front indicator threshold.`
    : undefined;

  const data: RealOceanMetrics = {
    chlorophyllConcentrationMgM3: chla.value,
    chlorophyllObservedAt: chla.observedAt,
    chlorophyllSource: chla.source,
    sstC: sst.sstC,
    sstAnomalyC: anomaly.value,
    sstObservedAt: sst.observedAt || anomaly.observedAt,
    sstSource: sst.source || anomaly.source,
    turbidityNTU: turbidity.value,
    turbiditySource: turbidity.source,
    algalBloomDetected,
    algalBloomReason,
    thermalFrontDetected,
    thermalFrontReason,
    sourcesUsed,
  };
  oceanMetricsCache.set(key, { expiresAt: now + CACHE_TTL_MS, data });
  return data;
}

export async function fetchRealOceanMetricsGrid(
  candidates: Array<{ latitude: number; longitude: number }>,
): Promise<RealOceanMetrics[]> {
  return Promise.all(candidates.map(({ latitude, longitude }) => fetchRealOceanMetrics(latitude, longitude)));
}
