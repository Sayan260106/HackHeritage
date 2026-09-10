import type { MarineObservationSource, MarineSourceObservation } from './marineDataSource.ts';

const ERDDAP_URL = process.env.INCOIS_ERDDAP_URL || 'https://erddap.incois.gov.in/erddap/tabledap/Indian_ARGO_Floats.json';
const REQUEST_TIMEOUT_MS = Number(process.env.REALTIME_DATA_TIMEOUT_MS || 8000);
const SEARCH_RADIUS_DEG = Number(process.env.INCOIS_ERDDAP_SEARCH_RADIUS_DEG || 2);
const MAX_LOOKBACK_DAYS = Number(process.env.INCOIS_ERDDAP_MAX_LOOKBACK_DAYS || 730);

interface ErddapTable { columnNames?: string[]; rows?: unknown[][]; }
interface ErddapResponse { table?: ErddapTable; }

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

function parseDate(value: unknown): string | undefined {
  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function distanceSquared(lat: number, lon: number, rowLat: number, rowLon: number): number {
  const lonDelta = Math.abs(rowLon - lon);
  const wrappedLonDelta = Math.min(lonDelta, 360 - lonDelta);
  return (rowLat - lat) ** 2 + wrappedLonDelta ** 2;
}

function queryUrl(lat: number, lon: number): string {
  const minLat = Math.max(-90, lat - SEARCH_RADIUS_DEG);
  const maxLat = Math.min(90, lat + SEARCH_RADIUS_DEG);
  const minLon = Math.max(-180, lon - SEARCH_RADIUS_DEG);
  const maxLon = Math.min(180, lon + SEARCH_RADIUS_DEG);
  const since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86400000).toISOString();
  const projection = encodeURIComponent('time,latitude,longitude,PRES,TEMP,PSAL');
  return `${ERDDAP_URL}?${projection}`
    + `&latitude>=${minLat}&latitude<=${maxLat}`
    + `&longitude>=${minLon}&longitude<=${maxLon}`
    + '&PRES>=0&PRES<=10'
    + `&time>=${encodeURIComponent(since)}`;
}

async function fetchJson(url: string): Promise<ErddapResponse> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`INCOIS ERDDAP HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return response.json() as Promise<ErddapResponse>;
}

function selectSurfaceProfile(table: ErddapTable | undefined, lat: number, lon: number) {
  const columns = table?.columnNames || [];
  const rows = table?.rows || [];
  const index = (name: string) => columns.indexOf(name);
  const timeIndex = index('time');
  const latIndex = index('latitude');
  const lonIndex = index('longitude');
  const pressureIndex = index('PRES');
  const tempIndex = index('TEMP');
  const salinityIndex = index('PSAL');
  if ([timeIndex, latIndex, lonIndex, pressureIndex, tempIndex, salinityIndex].some((value) => value < 0)) return undefined;

  const candidates = rows.map((row) => ({
    time: parseDate(row[timeIndex]), rowLat: Number(row[latIndex]), rowLon: Number(row[lonIndex]),
    pressure: Number(row[pressureIndex]), temp: Number(row[tempIndex]), salinity: Number(row[salinityIndex]),
  })).filter((candidate) => candidate.time && finite(candidate.rowLat) && finite(candidate.rowLon)
    && finite(candidate.pressure) && candidate.pressure >= 0 && candidate.pressure <= 10 && finite(candidate.temp));
  if (!candidates.length) return undefined;

  candidates.sort((a, b) => {
    const distanceA = distanceSquared(lat, lon, a.rowLat, a.rowLon);
    const distanceB = distanceSquared(lat, lon, b.rowLat, b.rowLon);
    if (distanceA !== distanceB) return distanceA - distanceB;
    return Date.parse(b.time!) - Date.parse(a.time!);
  });
  return candidates[0];
}

export const incoisErddapProvider: MarineObservationSource = {
  id: 'INCOIS',
  displayName: 'INCOIS Indian Argo / ERDDAP',
  priority: 100,
  enabled: process.env.INCOIS_ERDDAP_ENABLED !== 'false',
  async fetch(lat, lon): Promise<MarineSourceObservation> {
    const retrievedAt = new Date().toISOString();
    try {
      const payload = await fetchJson(queryUrl(lat, lon));
      const selected = selectSurfaceProfile(payload.table, lat, lon);
      if (!selected?.time) {
        return { source: 'INCOIS', observedAt: new Date(0).toISOString(), retrievedAt, availability: 'DEGRADED', qualityScore: 0, warnings: ['INCOIS ERDDAP is reachable, but no nearby near-surface Argo profile was returned.'] };
      }
      const values: Record<string, number> = { seaSurfaceTemperatureC: selected.temp };
      if (finite(selected.salinity)) values.salinityPsu = selected.salinity;
      return {
        source: 'INCOIS', observedAt: selected.time, retrievedAt, availability: 'LIVE',
        values: values as MarineSourceObservation['values'],
        warnings: ['INCOIS Argo is an in-situ profile source. Only near-surface temperature is fused into the current XGBoost feature contract; it does not replace wind/wave observations.'],
        qualityScore: 1,
      };
    } catch (error) {
      return { source: 'INCOIS', observedAt: new Date(0).toISOString(), retrievedAt, availability: 'DEGRADED', qualityScore: 0, warnings: [`INCOIS ERDDAP request failed: ${error instanceof Error ? error.message : String(error)}`] };
    }
  },
};
