import { GisLayerData, LocationInfo, OceanData, RiskLevel, RiskPrediction } from '../../src/types.ts';

export type GisZoneCategory = 'restricted_zone' | 'precaution_zone' | 'fishing_zone' | 'port_buffer';

export interface GisZone {
  id: string;
  name: string;
  category: GisZoneCategory;
  riskLevel?: RiskLevel;
  polygon: [number, number][];
  authority: string;
  operationalStatus: 'ACTIVE' | 'REFERENCE';
  description: string;
}

export interface GisSpatialAnalysis {
  latitude: number;
  longitude: number;
  insideZoneIds: string[];
  insideRestrictedZone: boolean;
  nearestZone?: { id: string; name: string; category: GisZoneCategory; distanceKm: number };
  nearestPort?: { name: string; distanceKm: number };
  operationalWarnings: string[];
  dataQuality: 'DETERMINISTIC' | 'DEGRADED';
  source: string;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function pointInPolygon(latitude: number, longitude: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > latitude) !== (yj > latitude))
      && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function squarePolygon(latitude: number, longitude: number, radiusKm: number): [number, number][] {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(0.2, Math.cos(toRadians(latitude))));
  return [
    [longitude - lonDelta, latitude - latDelta],
    [longitude + lonDelta, latitude - latDelta],
    [longitude + lonDelta, latitude + latDelta],
    [longitude - lonDelta, latitude + latDelta],
    [longitude - lonDelta, latitude - latDelta]
  ];
}

/**
 * Builds the operational GIS registry for the current coastal context.
 * These are ORCA-X decision-support zones, not statutory maritime boundaries.
 */
export function buildOperationalZones(location: LocationInfo, risk: RiskPrediction): GisZone[] {
  const hazardRadiusKm = risk.riskLevel === 'EXTREME' ? 10 : risk.riskLevel === 'HIGH' ? 7 : risk.riskLevel === 'MODERATE' ? 4 : 2.5;
  const precautionRadiusKm = Math.max(1.5, hazardRadiusKm * 0.55);

  return [
    {
      id: `orca-hazard-${location.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${location.name} operational hazard zone`,
      category: 'restricted_zone',
      riskLevel: risk.riskLevel,
      polygon: squarePolygon(location.latitude, location.longitude + 0.04, hazardRadiusKm),
      authority: 'ORCA-X operational risk engine',
      operationalStatus: 'REFERENCE',
      description: `Dynamic decision-support zone derived from the current ${risk.riskLevel} marine risk state.`
    },
    {
      id: `orca-precaution-${location.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${location.name} precaution buffer`,
      category: 'precaution_zone',
      riskLevel: risk.riskLevel === 'EXTREME' ? 'HIGH' : risk.riskLevel === 'HIGH' ? 'MODERATE' : 'LOW',
      polygon: squarePolygon(location.latitude, location.longitude, precautionRadiusKm),
      authority: 'ORCA-X operational GIS',
      operationalStatus: 'REFERENCE',
      description: 'Dynamic buffer for additional navigation caution around the resolved operating point.'
    }
  ];
}

export function analyzeSpatialContext(
  location: LocationInfo,
  risk: RiskPrediction,
  zones: GisZone[] = buildOperationalZones(location, risk)
): GisSpatialAnalysis {
  const inside = zones.filter(zone => pointInPolygon(location.latitude, location.longitude, zone.polygon));
  const distances = zones.map(zone => {
    const centroid = zone.polygon.slice(0, -1).reduce(
      (acc, point) => [acc[0] + point[1], acc[1] + point[0]],
      [0, 0]
    );
    const count = Math.max(1, zone.polygon.length - 1);
    return {
      id: zone.id,
      name: zone.name,
      category: zone.category,
      distanceKm: haversineDistanceKm(location.latitude, location.longitude, centroid[0] / count, centroid[1] / count)
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm);

  const warnings: string[] = [];
  if (inside.some(zone => zone.category === 'restricted_zone')) {
    warnings.push('Resolved operating point intersects an ORCA-X dynamic restricted-risk zone.');
  }
  if (risk.riskLevel === 'HIGH' || risk.riskLevel === 'EXTREME') {
    warnings.push(`Current model risk is ${risk.riskLevel}; avoid treating the generated corridor as a statutory safe passage.`);
  }
  warnings.push('Geofence results are decision-support overlays and do not replace official nautical charts or statutory maritime boundaries.');

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    insideZoneIds: inside.map(zone => zone.id),
    insideRestrictedZone: inside.some(zone => zone.category === 'restricted_zone'),
    nearestZone: distances[0],
    nearestPort: location.nearestPort
      ? { name: location.nearestPort, distanceKm: 0 }
      : undefined,
    operationalWarnings: warnings,
    dataQuality: 'DETERMINISTIC',
    source: 'ORCA-X operational GIS registry'
  };
}

export function buildGisIntelligence(
  location: LocationInfo,
  risk: RiskPrediction,
  ocean: OceanData,
  existingLayers: GisLayerData
): GisLayerData & { spatialAnalysis: GisSpatialAnalysis; zones: GisZone[] } {
  const zones = buildOperationalZones(location, risk);
  const spatialAnalysis = analyzeSpatialContext(location, risk, zones);
  const geofenceFeatures = zones.map(zone => ({
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [zone.polygon] },
    properties: {
      name: zone.name,
      category: zone.category === 'restricted_zone' ? 'hazard_zone' as const : 'precaution_zone' as const,
      riskLevel: zone.riskLevel,
      description: zone.description,
      color: zone.category === 'restricted_zone' ? '#c4372f' : '#de9a1f',
      details: {
        zoneId: zone.id,
        authority: zone.authority,
        operationalStatus: zone.operationalStatus
      }
    }
  }));

  return {
    ...existingLayers,
    features: [...existingLayers.features, ...geofenceFeatures],
    spatialAnalysis,
    zones
  };
}
