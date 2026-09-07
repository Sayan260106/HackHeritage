import assert from 'node:assert/strict';
import { COASTAL_LOCATIONS } from '../src/data/coastalData.ts';
import { RiskPrediction } from '../src/types.ts';
import { analyzeSpatialContext, buildGisIntelligence, buildOperationalZones, haversineDistanceKm, pointInPolygon } from '../server/services/gisIntelligence.ts';

const location = COASTAL_LOCATIONS.digha;

const risk: RiskPrediction = {
  riskScore: 72,
  riskLevel: 'HIGH',
  confidenceScore: 85,
  modelVersion: 'test',
  predictionTarget: 'test',
  primaryRecommendation: 'Avoid exposed waters.',
  safetySummary: 'High operational risk.',
  actionableAdvisories: [],
  restrictedCraftTypes: [],
  safeCraftTypes: [],
  featureContributions: [],
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  generatedAt: new Date().toISOString()
};

const ocean = {
  waveHeightMeters: 2.2,
  maxWaveHeightMeters: 2.8,
  wavePeriodSec: 8,
  waveDirectionDeg: 180,
  swellHeightMeters: 1.4,
  swellPeriodSec: 11,
  swellDirectionDeg: 180,
  seaSurfaceTemperatureC: 28,
  currentSpeedKts: 1.1,
  currentDirectionDeg: 90,
  seaStateIndex: 4,
  seaStateDescription: 'Moderate',
  tidePhase: 'Flood Tide' as const,
  source: 'test',
  observedAt: new Date().toISOString()
};

assert.ok(Math.abs(haversineDistanceKm(location.latitude, location.longitude, location.latitude, location.longitude)) < 0.001);
const square: [number, number][] = [[87.4, 21.5], [87.6, 21.5], [87.6, 21.7], [87.4, 21.7], [87.4, 21.5]];
assert.equal(pointInPolygon(21.6266, 87.5074, square), true);
assert.equal(pointInPolygon(22, 87.5, square), false);

const zones = buildOperationalZones(location, risk);
assert.equal(zones.length, 2);
assert.ok(zones.some(zone => zone.category === 'hazard_zone'));
assert.ok(zones.some(zone => zone.category === 'precaution_zone'));
assert.ok(zones.every(zone => zone.category !== 'restricted_zone'));
assert.ok(zones.every(zone => zone.polygon.length === 5));
assert.ok(zones.find(zone => zone.category === 'hazard_zone')?.description.includes('not a statutory restricted area'));

const spatial = analyzeSpatialContext(location, risk, zones);
assert.equal(spatial.insideRestrictedZone, false);
assert.ok(spatial.insideZoneIds.length >= 1);
assert.equal(spatial.dataQuality, 'DETERMINISTIC');
assert.ok(spatial.operationalWarnings.some(warning => warning.includes('decision-support overlays')));
assert.ok(spatial.operationalWarnings.some(warning => warning.includes('dynamic hazard overlay')));
assert.equal(spatial.nearestPort?.name, location.nearestPort);
assert.equal(spatial.nearestPort?.distanceAvailable, false);
assert.equal(spatial.nearestPort?.distanceKm, undefined);

const layers = buildGisIntelligence(location, risk, ocean, { type: 'FeatureCollection', features: [] });
assert.equal(layers.features.length, 2);
assert.equal(layers.spatialAnalysis.insideRestrictedZone, false);
assert.equal(layers.zones.length, 2);
assert.deepEqual(layers.features.map(feature => feature.properties?.category), ['hazard_zone', 'precaution_zone']);
assert.equal(layers.features[0]?.properties?.details?.statutoryBoundary, false);

console.log('ORCA-X GIS intelligence tests passed.');
