import assert from 'node:assert/strict';
import { clearAlertCooldowns, evaluateMarineAlerts } from '../server/services/alertEngine.ts';
import type { OceanData, RiskPrediction, WeatherData } from '../src/types.ts';

const weather: WeatherData = {
  airTemperatureC: 29, windSpeedKts: 32, windGustKts: 48, windDirectionDeg: 270, windDirectionCompass: 'W', precipitationMm: 4,
  cloudCoverPct: 90, visibilityKm: 5, pressureHpa: 1002, weatherCode: 96, weatherDescription: 'Severe thunderstorm', source: 'TEST WEATHER', observedAt: new Date().toISOString(), dataQuality: 'LIVE'
};
const ocean: OceanData = {
  waveHeightMeters: 4.2, maxWaveHeightMeters: 4.8, wavePeriodSec: 8, waveDirectionDeg: 250, swellHeightMeters: 2.1, swellPeriodSec: 11,
  swellDirectionDeg: 240, seaSurfaceTemperatureC: 29, currentSpeedKts: 1.2, currentDirectionDeg: 180, seaStateIndex: 6,
  seaStateDescription: 'Very Rough to High', tidePhase: 'Unknown', source: 'TEST MARINE', observedAt: new Date().toISOString(), dataQuality: 'LIVE'
};
const risk: RiskPrediction = {
  riskScore: 82, riskLevel: 'HIGH', confidenceScore: 91, modelVersion: 'test-model', predictionTarget: 'future_risk_class',
  primaryRecommendation: 'Avoid exposed operations.', safetySummary: 'High marine risk.', actionableAdvisories: ['Avoid departure.'], restrictedCraftTypes: [], safeCraftTypes: [], featureContributions: [],
  validUntil: new Date(Date.now() + 3600000).toISOString(), generatedAt: new Date().toISOString()
};

clearAlertCooldowns();
const first = evaluateMarineAlerts({ weather, ocean, risk, previousRiskLevel: 'MODERATE', previousRiskScore: 55 });
assert.ok(first.activeAlertCount >= 5, `expected multiple alerts, got ${first.activeAlertCount}`);
assert.equal(first.highestSeverity, 'CRITICAL');
assert.ok(first.alerts.some(alert => alert.type === 'LIGHTNING'));
assert.ok(first.alerts.some(alert => alert.type === 'CYCLONE_PROXY'));
assert.ok(first.alerts.some(alert => alert.type === 'SEA_STATE'));
assert.ok(first.alerts.some(alert => alert.type === 'SEVERE_WEATHER'));
assert.ok(first.alerts.some(alert => alert.type === 'MARINE_RISK_CHANGE'));

const second = evaluateMarineAlerts({ weather, ocean, risk, previousRiskLevel: 'MODERATE', previousRiskScore: 55 });
assert.equal(second.activeAlertCount, 0, 'cooldown should suppress duplicate alerts');

clearAlertCooldowns();
const clearWeather = { ...weather, weatherCode: 1, windGustKts: 12 };
const clearOcean = { ...ocean, waveHeightMeters: 0.4, seaStateIndex: 1 };
const lowRisk = { ...risk, riskScore: 12, riskLevel: 'LOW' as const };
const clear = evaluateMarineAlerts({ weather: clearWeather, ocean: clearOcean, risk: lowRisk });
assert.equal(clear.activeAlertCount, 0);
assert.equal(clear.highestSeverity, 'NONE');

console.log('ORCA-X marine alert engine tests passed:', {
  criticalScenarioAlerts: first.activeAlertCount,
  highestSeverity: first.highestSeverity,
  cooldownSuppressed: second.activeAlertCount === 0,
  clearScenarioAlerts: clear.activeAlertCount,
});
