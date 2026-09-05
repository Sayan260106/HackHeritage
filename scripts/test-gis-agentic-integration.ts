import assert from 'node:assert/strict';
import { createOrcaPlan } from '../server/services/agenticPlanner.ts';
import { buildGisIntelligence } from '../server/services/gisIntelligence.ts';
import { COASTAL_LOCATIONS } from '../src/data/coastalData.ts';
import type { OceanData, RiskPrediction } from '../src/types.ts';

const location = COASTAL_LOCATIONS.goa;
assert.ok(location, 'Goa coastal location must exist');

const risk: RiskPrediction = {
  riskScore: 18,
  riskLevel: 'LOW',
  confidenceScore: 91,
  modelVersion: 'test',
  predictionTarget: 'future_risk_class',
  primaryRecommendation: 'Routine operations with standard precautions.',
  safetySummary: 'Low operational risk.',
  actionableAdvisories: [],
  restrictedCraftTypes: [],
  safeCraftTypes: ['small_vessel'],
  featureContributions: [],
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  generatedAt: new Date().toISOString()
};

const ocean: OceanData = {
  waveHeightMeters: 0.8,
  maxWaveHeightMeters: 1.2,
  wavePeriodSec: 6,
  waveDirectionDeg: 250,
  swellHeightMeters: 0.5,
  swellPeriodSec: 8,
  swellDirectionDeg: 250,
  seaSurfaceTemperatureC: 28,
  currentSpeedKts: 0.4,
  currentDirectionDeg: 180,
  seaStateIndex: 2,
  seaStateDescription: 'Slight',
  tidePhase: 'Unknown',
  source: 'test',
  observedAt: new Date().toISOString()
};

const fishingPlan = createOrcaPlan('What is the marine safety risk for fishing in Goa?');
const fishingGis = fishingPlan.tasks.find(task => task.id === 'gis');
assert.equal(fishingGis?.enabled, true, 'Fishing safety queries must enable GIS reasoning');
assert.deepEqual(fishingGis?.dependsOn, ['resolve_location_time', 'risk']);
assert.equal(fishingPlan.tasks.find(task => task.id === 'synthesis')?.dependsOn.includes('gis'), true);

const mapPlan = createOrcaPlan('Show the nearest restricted zone and distance from Goa.');
assert.equal(mapPlan.tasks.find(task => task.id === 'gis')?.enabled, true);

const generalPlan = createOrcaPlan('What is the sea temperature in Goa?');
assert.equal(generalPlan.tasks.find(task => task.id === 'gis')?.enabled, false, 'Pure environmental lookup should not require GIS');

const layers = buildGisIntelligence(location, risk, ocean, { type: 'FeatureCollection', features: [] });
assert.equal(layers.spatialAnalysis.dataQuality, 'DETERMINISTIC');
assert.ok(layers.zones.length >= 2);
assert.equal(layers.features.length, layers.zones.length);
assert.ok(layers.spatialAnalysis.insideZoneIds.length >= 1);
assert.equal(layers.spatialAnalysis.insideRestrictedZone, false);
assert.ok(layers.zones.some(zone => zone.category === 'hazard_zone'));
assert.ok(layers.zones.some(zone => zone.category === 'precaution_zone'));
assert.ok(layers.spatialAnalysis.operationalWarnings.some(warning => warning.includes('dynamic hazard overlay')));
assert.equal(layers.spatialAnalysis.nearestPort?.distanceAvailable, false);
assert.equal(layers.spatialAnalysis.nearestPort?.distanceKm, undefined);
assert.ok(layers.features.every(feature => feature.properties?.details.statutoryBoundary === false));

console.log('GIS agentic integration tests passed:', {
  fishingGisEnabled: fishingGis?.enabled,
  fishingGisDependencies: fishingGis?.dependsOn,
  generatedZones: layers.zones.length,
  containingZones: layers.spatialAnalysis.insideZoneIds.length,
  hazardZoneCategory: layers.zones.find(zone => zone.category === 'hazard_zone')?.category,
  portDistanceAvailable: layers.spatialAnalysis.nearestPort?.distanceAvailable
});
