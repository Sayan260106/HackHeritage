import { SatelliteData, SatelliteObservation } from '../../types.ts';
import { fetchRealOceanMetrics } from './realOceanColorService.ts';

type StacItem = {
  id?: string;
  type?: string;
  collection?: string;
  properties?: Record<string, unknown>;
  assets?: Record<string, unknown>;
  links?: Array<{ rel?: string; href?: string }>;
};

const COLLECTIONS = {
  s3OlciWater: ['sentinel-3-olci-2-wfr-nrt', 'sentinel-3-olci-2-wfr-ntc', 'sentinel-3-olci-2-wrr-nrt', 'sentinel-3-olci-2-wrr-ntc'],
  s3WaterTemperature: ['sentinel-3-sl-2-wst-nrt', 'sentinel-3-sl-2-wst-ntc'],
  s1Grd: ['sentinel-1-grd'],
  s2L2a: ['sentinel-2-l2a'],
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const satelliteCache = new Map<string, { expiresAt: number; data: SatelliteData }>();

function getStacConfig() {
  const baseUrl = (process.env.COPERNICUS_STAC_URL || 'https://stac.dataspace.copernicus.eu/v1').replace(/\/$/, '');
  return { baseUrl, searchUrl: `${baseUrl}/search`, browserUrl: 'https://browser.stac.dataspace.copernicus.eu' };
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function bboxAroundPoint(lat: number, lon: number, radiusDegrees = 0.15): [number, number, number, number] {
  return [lon - radiusDegrees, lat - radiusDegrees, lon + radiusDegrees, lat + radiusDegrees];
}

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function findItemUrl(item: StacItem): string | undefined {
  const { browserUrl } = getStacConfig();
  const self = item.links?.find(link => link.rel === 'self')?.href;
  return self || (item.id ? `${browserUrl}/collection/${item.collection}/item/${encodeURIComponent(item.id)}` : undefined);
}

function findSelfUrl(item: StacItem): string | undefined {
  return item.links?.find(link => link.rel === 'self')?.href;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => v * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToBboxKm(lat: number, lon: number, bbox: unknown): number | undefined {
  if (!Array.isArray(bbox) || bbox.length < 4) return undefined;
  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return undefined;
  if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) return 0;

  const clampedLat = Math.min(maxLat, Math.max(minLat, lat));
  const clampedLon = Math.min(maxLon, Math.max(minLon, lon));
  return distanceKm(lat, lon, clampedLat, clampedLon);
}

function distanceToObservationKm(item: StacItem, lat: number, lon: number): number | undefined {
  const bboxDistance = distanceToBboxKm(lat, lon, (item as any).bbox);
  if (typeof bboxDistance === 'number') return bboxDistance;

  const geometry = (item as any).geometry;
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return distanceKm(lat, lon, Number(geometry.coordinates[1]), Number(geometry.coordinates[0]));
  }

  const bbox = (item as any).bbox;
  if (Array.isArray(bbox) && bbox.length >= 4) return distanceKm(lat, lon, Number((bbox[1] + bbox[3]) / 2), Number((bbox[0] + bbox[2]) / 2));
  return undefined;
}

async function searchCollections(collectionIds: string[], lat: number, lon: number, start: string, end: string, limit = 24): Promise<StacItem[]> {
  const { searchUrl } = getStacConfig();
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json, application/json' },
    body: JSON.stringify({ collections: collectionIds, bbox: bboxAroundPoint(lat, lon), datetime: `${start}/${end}`, limit, sortby: [{ field: 'datetime', direction: 'desc' }] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`Copernicus STAC ${response.status}: ${(await response.text().catch(() => '')).slice(0, 180)}`);
  const json = await response.json() as { features?: StacItem[] };
  return Array.isArray(json.features) ? json.features : [];
}

async function fetchItemDetail(item: StacItem): Promise<StacItem> {
  const selfUrl = findSelfUrl(item);
  if (!selfUrl) return item;

  try {
    const response = await fetch(selfUrl, {
      headers: { Accept: 'application/geo+json, application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return item;
    const detail = await response.json() as StacItem;
    return {
      ...item,
      ...detail,
      properties: { ...(item.properties || {}), ...(detail.properties || {}) },
      assets: detail.assets || item.assets,
      links: detail.links || item.links,
    };
  } catch {
    return item;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function privateProductSizeMb(properties: Record<string, unknown>): number | undefined {
  const privateInfo = properties._private;
  if (!privateInfo || typeof privateInfo !== 'object') return undefined;
  const size = numberValue((privateInfo as Record<string, unknown>).product_size);
  return typeof size === 'number' ? Math.round((size / 1024 / 1024) * 10) / 10 : undefined;
}

function sceneStatistic(properties: Record<string, unknown>, key: string): number | undefined {
  const statistics = properties.statistics;
  if (!statistics || typeof statistics !== 'object') return undefined;
  return numberValue((statistics as Record<string, unknown>)[key]);
}

function toObservation(item: StacItem, lat: number, lon: number): SatelliteObservation {
  const properties = item.properties || {};
  const instruments = properties.instruments;
  return {
    collectionId: item.collection || 'unknown',
    collectionTitle: String(properties.title || item.collection || 'Copernicus product'),
    productId: item.id || 'unknown',
    productUrl: findItemUrl(item),
    platform: stringValue(properties.platform) || stringValue(properties.constellation),
    instrument: Array.isArray(instruments) ? instruments.join(', ') : stringValue(instruments),
    acquisitionTime: stringValue(properties.datetime) || stringValue(properties.start_datetime),
    cloudCoverPct: numberValue(properties['eo:cloud_cover']),
    distanceKm: distanceToObservationKm(item, lat, lon),
    observationAgeHours: ageHours(stringValue(properties.datetime) || stringValue(properties.start_datetime)),
    processingLevel: stringValue(properties['processing:level']),
    productType: stringValue(properties['product:type']),
    timeliness: stringValue(properties['product:timeliness_category']) || stringValue(properties['product:timeliness']),
    orbitState: stringValue(properties['sat:orbit_state']),
    relativeOrbit: numberValue(properties['sat:relative_orbit']),
    productSizeMb: privateProductSizeMb(properties),
    assetCount: item.assets ? Object.keys(item.assets).length : undefined,
    sceneWaterPct: sceneStatistic(properties, 'water'),
    sceneVegetationPct: sceneStatistic(properties, 'vegetation'),
    sceneCloudShadowPct: sceneStatistic(properties, 'cloud_shadow'),
    sceneHighCloudPct: sceneStatistic(properties, 'high_proba_clouds'),
    sceneMediumCloudPct: sceneStatistic(properties, 'medium_proba_clouds'),
  };
}

function ageHours(iso?: string): number | undefined {
  if (!iso) return undefined;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? undefined : Math.max(0, (Date.now() - time) / 3600000);
}

function buildNoObservation(lat: number, lon: number, warnings: string[]): SatelliteData {
  const { baseUrl } = getStacConfig();
  return {
    status: 'UNAVAILABLE',
    satelliteName: 'Copernicus Sentinel observation search',
    processingTime: new Date().toISOString(),
    latitude: lat,
    longitude: lon,
    source: 'Copernicus Data Space Ecosystem STAC Catalogue',
    sourceUrl: baseUrl,
    observationType: 'NO_OBSERVATION',
    warnings,
    observations: [],
  };
}

function acquisitionMillis(observation: SatelliteObservation): number {
  const value = observation.acquisitionTime ? new Date(observation.acquisitionTime).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function observationRank(observation: SatelliteObservation): number {
  const agePenalty = observation.observationAgeHours ?? 9999;
  const distancePenalty = observation.distanceKm ?? 9999;
  const cloudPenalty = observation.cloudCoverPct ?? 50;
  return agePenalty * 4 + distancePenalty * 0.08 + cloudPenalty * 0.2;
}

export async function fetchSatelliteData(lat: number, lon: number, resolvedStartTime: string, resolvedEndTime: string, bypassCache = false): Promise<SatelliteData> {
  const { baseUrl } = getStacConfig();
  const now = new Date();
  const key = cacheKey(lat, lon);
  const cached = satelliteCache.get(key);
  if (!bypassCache && cached && cached.expiresAt > now.getTime()) return cached.data;

  const requestedStart = new Date(toIso(resolvedStartTime));
  const requestedEnd = new Date(toIso(resolvedEndTime));
  const searchEnd = new Date(Math.min(requestedEnd.getTime(), now.getTime()));
  if (requestedStart > requestedEnd) return buildNoObservation(lat, lon, ['Invalid satellite observation window: start time is after end time.']);

  const searchStart = new Date(searchEnd.getTime() - 7 * 24 * 3600000);
  if (searchEnd <= searchStart) return buildNoObservation(lat, lon, ['No valid satellite observation window could be constructed.']);

  const start = searchStart.toISOString();
  const end = searchEnd.toISOString();
  const warnings: string[] = [];
  const observations: SatelliteObservation[] = [];

  const allCollectionIds = [
    ...COLLECTIONS.s3OlciWater,
    ...COLLECTIONS.s3WaterTemperature,
    ...COLLECTIONS.s1Grd,
    ...COLLECTIONS.s2L2a,
  ];
  let searchedItems: StacItem[] = [];
  let realOcean: Awaited<ReturnType<typeof fetchRealOceanMetrics>> = { sourcesUsed: [] };

  try {
    const [stacRes, oceanRes] = await Promise.allSettled([
      searchCollections(allCollectionIds, lat, lon, start, end),
      fetchRealOceanMetrics(lat, lon)
    ]);
    if (stacRes.status === 'fulfilled') {
      searchedItems = stacRes.value;
    } else {
      warnings.push(`Copernicus STAC search degraded: ${stacRes.reason instanceof Error ? stacRes.reason.message : String(stacRes.reason)}`);
    }
    if (oceanRes.status === 'fulfilled') {
      realOcean = oceanRes.value;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Satellite fetch exception: ${msg}`);
  }

  let allItems: StacItem[] = [];
  if (searchedItems.length > 0) {
    try {
      allItems = await Promise.all(searchedItems.slice(0, 12).map(fetchItemDetail));
    } catch {
      allItems = searchedItems.slice(0, 12);
    }
  }

  const seen = new Set<string>();
  for (const item of allItems) {
    const observation = toObservation(item, lat, lon);
    const key = `${observation.collectionId}:${observation.productId}`;
    if (!seen.has(key)) {
      seen.add(key);
      observations.push(observation);
    }
  }
  observations.sort((a, b) => observationRank(a) - observationRank(b) || acquisitionMillis(b) - acquisitionMillis(a));
  observations.splice(12);

  if (!observations.length) {
    const defaultMsg = warnings.length > 0 ? warnings : [
      'No matching Copernicus Sentinel observation was found for the last 7 days around the requested location.',
      'Satellite-derived ocean indicators are therefore not available for this analysis.',
    ];
    const emptyResult = buildNoObservation(lat, lon, defaultMsg);
    if (realOcean.chlorophyllConcentrationMgM3 !== undefined) {
      emptyResult.chlorophyllConcentrationMgM3 = realOcean.chlorophyllConcentrationMgM3;
      emptyResult.sstC = realOcean.sstC;
      emptyResult.sstAnomalyC = realOcean.sstAnomalyC;
      emptyResult.turbidityNTU = realOcean.turbidityNTU;
      emptyResult.algalBloomDetected = realOcean.algalBloomDetected;
      emptyResult.thermalFrontDetected = realOcean.thermalFrontDetected;
      emptyResult.status = 'LIVE';
    }
    satelliteCache.set(key, { expiresAt: now.getTime() + CACHE_TTL_MS, data: emptyResult });
    return emptyResult;
  }

  const primary = observations[0];
  const optical = observations.find(o => o.collectionId.includes('olci'));
  const s1Observation = observations.find(o => o.collectionId === 'sentinel-1-grd');
  const wstObservation = observations.find(o => COLLECTIONS.s3WaterTemperature.includes(o.collectionId));
  const s2Observation = observations.find(o => o.collectionId === 'sentinel-2-l2a');
  const cloudValues = observations.map(o => o.cloudCoverPct).filter((v): v is number => typeof v === 'number');
  const cloudCoverPct = cloudValues.length ? Math.min(...cloudValues) : undefined;
  const distances = observations.map(o => o.distanceKm).filter((v): v is number => typeof v === 'number');
  const assetCounts = observations.map(o => o.assetCount).filter((v): v is number => typeof v === 'number');
  const productSizes = observations.map(o => o.productSizeMb).filter((v): v is number => typeof v === 'number');
  const waterValues = observations.map(o => o.sceneWaterPct).filter((v): v is number => typeof v === 'number');
  const highCloudValues = observations.map(o => o.sceneHighCloudPct).filter((v): v is number => typeof v === 'number');
  const mediumCloudValues = observations.map(o => o.sceneMediumCloudPct).filter((v): v is number => typeof v === 'number');

  if (!optical && !realOcean.chlorophyllConcentrationMgM3) warnings.push('No Sentinel-3 OLCI water observation was found; chlorophyll/turbidity metrics are unavailable.');
  if (!s1Observation) warnings.push('No Sentinel-1 GRD radar swath was found in current pass window; SAR roughness index unavailable.');
  if (!wstObservation && !realOcean.sstC) warnings.push('No Sentinel-3 water-surface-temperature product was found; SST metrics are unavailable.');
  if (!s2Observation) warnings.push('No Sentinel-2 L2A observation was found in the search window.');
  if (typeof cloudCoverPct === 'number' && cloudCoverPct > 60) warnings.push(`Best matching optical observation has high cloud cover (${cloudCoverPct.toFixed(0)}%).`);

  let sarRoughnessIndex: number | undefined = undefined;
  let surfaceSlickAnomalies: boolean | undefined = undefined;
  if (s1Observation) {
    surfaceSlickAnomalies = false;
  }

  const result: SatelliteData = {
    status: warnings.length ? 'DEGRADED' : 'LIVE',
    satelliteName: 'Copernicus Sentinel observation catalogue',
    platform: primary.platform,
    productId: primary.productId,
    productUrl: primary.productUrl,
    acquisitionTime: primary.acquisitionTime,
    processingTime: new Date().toISOString(),
    latitude: lat,
    longitude: lon,
    cloudCoverPct,
    confidenceScore: undefined,
    latestObservationAgeHours: ageHours(primary.acquisitionTime),
    nearestObservationDistanceKm: distances.length ? Math.min(...distances) : undefined,
    collectionCount: new Set(observations.map(o => o.collectionId)).size,
    totalAssetCount: assetCounts.length ? assetCounts.reduce((sum, value) => sum + value, 0) : undefined,
    totalProductSizeMb: productSizes.length ? Math.round(productSizes.reduce((sum, value) => sum + value, 0) * 10) / 10 : undefined,
    bestSceneWaterPct: waterValues.length ? Math.max(...waterValues) : undefined,
    bestSceneHighCloudPct: highCloudValues.length ? Math.min(...highCloudValues) : undefined,
    bestSceneMediumCloudPct: mediumCloudValues.length ? Math.min(...mediumCloudValues) : undefined,
    chlorophyllConcentrationMgM3: realOcean.chlorophyllConcentrationMgM3,
    sstC: realOcean.sstC,
    sstAnomalyC: realOcean.sstAnomalyC,
    turbidityNTU: realOcean.turbidityNTU,
    sarRoughnessIndex,
    surfaceSlickAnomalies,
    algalBloomDetected: realOcean.algalBloomDetected,
    thermalFrontDetected: realOcean.thermalFrontDetected,
    source: realOcean.sourcesUsed.length > 0 ? `Copernicus STAC & ${realOcean.sourcesUsed.join('; ')}` : 'Copernicus Data Space Ecosystem STAC Catalogue',
    sourceUrl: baseUrl,
    observationType: 'OBSERVATION',
    observationAgeHours: ageHours(primary.acquisitionTime),
    warnings,
    observations,
  };
  satelliteCache.set(key, { expiresAt: now.getTime() + CACHE_TTL_MS, data: result });
  return result;
}
