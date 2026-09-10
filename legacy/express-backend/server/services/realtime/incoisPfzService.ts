/**
 * INCOIS Daily Potential Fishing Zone (PFZ) Satellite Service
 *
 * Official Statutory Oceanographic Frontline Feed from:
 * Indian National Centre for Ocean Information Services (INCOIS),
 * Ministry of Earth Sciences (MoES), Government of India.
 *
 * Connects directly to INCOIS GeoServer WFS (`PFZ_Automation:pfzlines`)
 * and maintains an automated, resilient 24-hour local cache on disk.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface IncoisPfzProperties {
  SECTORBOUN?: number;
  SECTORBO_1?: number;
  SECTORNAME?: string;
  Julian_day?: string;
  Sno?: string;
  Year?: number;
  UID?: number;
  Length?: number; // Front length in km
}

export interface IncoisPfzFeature {
  type: 'Feature';
  id?: string;
  properties: IncoisPfzProperties;
  geometry: {
    type: 'MultiLineString' | 'LineString';
    coordinates: number[][][] | number[][];
  };
}

export interface IncoisPfzFeatureCollection {
  type: 'FeatureCollection';
  features: IncoisPfzFeature[];
  totalFeatures?: number;
  numberMatched?: number;
  numberReturned?: number;
  retrievedAt?: string;
}

export interface IncoisCandidateZone {
  uid: number | string;
  julianDay: string;
  year: number;
  frontLengthKm: number;
  closestLat: number;
  closestLon: number;
  distanceKm: number;
  distanceNm: number;
  bearingDeg: number;
  centroidLat: number;
  centroidLon: number;
  feature: IncoisPfzFeature;
}

const INCOIS_WFS_URL = 'https://incois.gov.in/geoserver/PFZ_Automation/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=PFZ_Automation:pfzlines&outputFormat=application/json';
const CACHE_FILE_PATH = path.resolve(process.cwd(), 'data/realtime/incois_pfz_daily.json');
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours statutory daily cycle

let inMemoryCache: { timestamp: number; data: IncoisPfzFeatureCollection } | null = null;

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateCompassBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return Math.round(((theta * 180) / Math.PI + 360) % 360);
}

/**
 * Load INCOIS PFZ GeoJSON features from memory, disk cache, or live GeoServer WFS
 */
export async function getIncoisDailyPfzFeatures(): Promise<IncoisPfzFeatureCollection> {
  const now = Date.now();
  if (inMemoryCache && now - inMemoryCache.timestamp < REFRESH_INTERVAL_MS) {
    return inMemoryCache.data;
  }

  // 1. Attempt to fetch fresh daily satellite frontlines from INCOIS GeoServer
  try {
    const res = await fetch(INCOIS_WFS_URL, {
      headers: {
        'User-Agent': 'ORCA-X/2.4 (Government Maritime Decision Support; INCOIS Research)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = (await res.json()) as IncoisPfzFeatureCollection;
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        data.retrievedAt = new Date().toISOString();
        inMemoryCache = { timestamp: now, data };
        // Persist to disk asynchronously
        writeFile(CACHE_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8').catch((err) => {
          console.warn('[INCOIS PFZ] Failed to persist cache to disk:', err);
        });
        return data;
      }
    }
  } catch (netErr) {
    console.warn('[INCOIS PFZ] Live GeoServer fetch delay/error, checking local daily cache:', netErr);
  }

  // 2. Fall back to local disk cache if available
  try {
    const diskContent = await readFile(CACHE_FILE_PATH, 'utf-8');
    const diskData = JSON.parse(diskContent) as IncoisPfzFeatureCollection;
    if (diskData && Array.isArray(diskData.features) && diskData.features.length > 0) {
      inMemoryCache = { timestamp: now, data: diskData };
      return diskData;
    }
  } catch (diskErr) {
    console.error('[INCOIS PFZ] Failed to read disk cache:', diskErr);
  }

  return { type: 'FeatureCollection', features: [] };
}

/**
 * Find the nearest official INCOIS satellite front lines relative to vessel or port
 */
export async function findNearestIncoisPfzZones(
  originLat: number,
  originLon: number,
  maxZones = 5
): Promise<IncoisCandidateZone[]> {
  const fc = await getIncoisDailyPfzFeatures();
  if (!fc.features || fc.features.length === 0) {
    return [];
  }

  const candidates: IncoisCandidateZone[] = [];

  for (const feature of fc.features) {
    if (!feature.geometry || !feature.geometry.coordinates) continue;

    // Normalise MultiLineString vs LineString
    const lines: number[][][] =
      feature.geometry.type === 'MultiLineString'
        ? (feature.geometry.coordinates as number[][][])
        : [feature.geometry.coordinates as number[][]];

    let minDistanceKm = Infinity;
    let closestPoint: [number, number] = [originLat, originLon];
    let sumLat = 0;
    let sumLon = 0;
    let totalPoints = 0;

    for (const line of lines) {
      for (const coord of line) {
        const lon = coord[0];
        const lat = coord[1];
        sumLat += lat;
        sumLon += lon;
        totalPoints++;

        const dist = haversineDistanceKm(originLat, originLon, lat, lon);
        if (dist < minDistanceKm) {
          minDistanceKm = dist;
          closestPoint = [lat, lon];
        }
      }
    }

    if (totalPoints === 0 || !Number.isFinite(minDistanceKm)) continue;

    const centroidLat = Number((sumLat / totalPoints).toFixed(4));
    const centroidLon = Number((sumLon / totalPoints).toFixed(4));
    const distanceKm = Number(minDistanceKm.toFixed(1));
    const distanceNm = Number((minDistanceKm / 1.852).toFixed(1));
    const bearingDeg = calculateCompassBearing(originLat, originLon, closestPoint[0], closestPoint[1]);
    const frontLengthKm = Number((feature.properties.Length ?? 15.0).toFixed(1));

    candidates.push({
      uid: feature.properties.UID || `incois-${candidates.length + 1}`,
      julianDay: String(feature.properties.Julian_day || new Date().toISOString().slice(0, 10)),
      year: feature.properties.Year || new Date().getFullYear(),
      frontLengthKm,
      closestLat: Number(closestPoint[0].toFixed(4)),
      closestLon: Number(closestPoint[1].toFixed(4)),
      distanceKm,
      distanceNm,
      bearingDeg,
      centroidLat,
      centroidLon,
      feature,
    });
  }

  // Sort by closest proximity to boat/harbor
  candidates.sort((a, b) => a.distanceKm - b.distanceKm);

  return candidates.slice(0, maxZones);
}
