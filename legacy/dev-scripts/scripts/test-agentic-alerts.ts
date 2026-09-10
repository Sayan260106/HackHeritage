import assert from 'node:assert/strict';
import { createOrcaPlan, getRunnableTasks, replanAfterFailure } from '../server/services/agenticPlanner.ts';
import { runAgenticAlertEvaluation } from '../server/services/agenticAlertAgent.ts';
import type { OceanData, RiskPrediction, WeatherData } from '../src/types.ts';

const weather: WeatherData = {
  airTemperatureC: 28, windSpeedKts: 34, windGustKts: 48, windDirectionDeg: 180, windDirectionCompass: 'S',
  precipitationMm: 8, cloudCoverPct: 92, visibilityKm: 5, pressureHpa: 1002, weatherCode: 96,
  weatherDescription: 'Thunderstorm with heavy rain', source: 'TEST', observedAt: new Date().toISOString(), dataQuality: 'LIVE',
};
const ocean: OceanData = {
  waveHeightMeters: 4.2, maxWaveHeightMeters: 4.8, wavePeriodSec: 8, waveDirectionDeg: 170,
  swellHeightMeters: 2.1, swellPeriodSec: 9, swellDirectionDeg: 175, seaSurfaceTemperatureC: 28,
  currentSpeedKts: 1.2, currentDirectionDeg: 160, seaStateIndex: 5, seaStateDescription: 'High',
  tidePhase: 'Flood Tide', tideHeightMeters: 1.4, source: 'TEST', observedAt: new Date().toISOString(), dataQuality: 'LIVE',
};
const risk: RiskPrediction = {
  riskScore: 86, riskLevel: 'HIGH', confidenceScore: 94, modelVersion: 'test', predictionTarget: 'future_risk_class',
  primaryRecommendation: 'Do not venture into exposed waters.', safetySummary: 'High operational risk.', actionableAdvisories: [],
  restrictedCraftTypes: [], safeCraftTypes: [], featureContributions: [], validUntil: new Date(Date.now() + 3600000).toISOString(), generatedAt: new Date().toISOString(),
};

const explicit = createOrcaPlan('Are there any lightning warnings or severe weather alerts near Goa?');
const explicitAlerts = explicit.tasks.find(task => task.id === 'alerts');
assert.equal(explicitAlerts?.enabled, true);
assert.deepEqual(explicitAlerts?.dependsOn, ['weather', 'ocean', 'risk', 'gis']);
assert.equal(explicit.intent, 'marine_alert_intelligence');

const fishing = createOrcaPlan('Is it safe for fishing tomorrow near Goa?');
const fishingAlerts = fishing.tasks.find(task => task.id === 'alerts');
assert.equal(fishingAlerts?.enabled, true);
assert.ok(fishingAlerts?.dependsOn.includes('pfz'));
assert.ok(fishingAlerts?.dependsOn.includes('gis'));
assert.ok(fishing.tasks.find(task => task.id === 'synthesis')?.dependsOn.includes('alerts'));

const neutral = createOrcaPlan('What is the current sea temperature near Goa?');
assert.equal(neutral.tasks.find(task => task.id === 'alerts')?.enabled, false);

const firstWave = getRunnableTasks(explicit);
assert.deepEqual(firstWave.map(task => task.id), ['resolve_location_time']);

const degraded = replanAfterFailure({ plan: explicit, failedTask: 'alerts', reason: 'alert connector unavailable' });
assert.equal(degraded.tasks.find(task => task.id === 'alerts')?.enabled, false);
assert.equal(degraded.tasks.find(task => task.id === 'synthesis')?.enabled, true);

const evaluation = runAgenticAlertEvaluation({ weather, ocean, risk });
assert.equal(evaluation.decision, 'ACT');
assert.equal(evaluation.highestSeverity, 'CRITICAL');
assert.ok(evaluation.activeAlertCount >= 4);
assert.ok(evaluation.nextActions.length > 0);

console.log('ORCA-X agentic alert tests passed:', {
  explicitAlertsEnabled: explicitAlerts?.enabled,
  explicitAlertDependencies: explicitAlerts?.dependsOn,
  fishingAlertDependencies: fishingAlerts?.dependsOn,
  neutralAlertsEnabled: neutral.tasks.find(task => task.id === 'alerts')?.enabled,
  firstRunnableWave: firstWave.map(task => task.id),
  decision: evaluation.decision,
  highestSeverity: evaluation.highestSeverity,
  alertCount: evaluation.activeAlertCount,
});
