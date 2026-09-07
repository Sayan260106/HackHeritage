import assert from 'node:assert/strict';
import { runAgenticSafeRouting } from '../server/services/agenticSafeRouting.ts';
import type { LocationInfo, RiskPrediction } from '../src/types.ts';

const origin: LocationInfo = {
  name: 'Goa',
  country: 'India',
  latitude: 15.4909,
  longitude: 73.8278,
  regionType: 'coastal_harbor',
};

const baseRisk = {
  riskScore: 10,
  riskLevel: 'LOW',
  confidenceScore: 95,
  modelVersion: 'test',
  predictionTarget: 'future_risk_class',
  primaryRecommendation: 'Proceed with normal caution.',
  safetySummary: 'Low modelled risk.',
  actionableAdvisories: [],
  restrictedCraftTypes: [],
  safeCraftTypes: ['all'],
  featureContributions: [],
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  generatedAt: new Date().toISOString(),
} as RiskPrediction;

const pfz = {
  status: 'AVAILABLE',
  zones: [],
  bestZone: {
    id: 'PFZ-TEST',
    latitude: 15.62,
    longitude: 73.95,
    score: 82,
    suitability: 'HIGH',
    confidence: 'HIGH',
    geofenceStatus: 'CLEAR',
  },
  warnings: [],
  decision: {
    decision: 'PROCEED',
    confidence: 'HIGH',
    score: 90,
    rationale: 'Test fixture.',
    factors: [],
    warnings: [],
  },
} as any;

const ready = runAgenticSafeRouting({ origin, risk: baseRisk, pfz });
assert.equal(ready.status, 'ROUTE_FOUND');
assert.equal(ready.decision.decision, 'PROCEED');
assert.ok(ready.route?.waypoints.length);
assert.equal(ready.destinationLabel, 'PFZ-TEST');
console.log(`✓ Agentic route found to selected PFZ: ${ready.route?.distanceKm} km`);

const dangerous = runAgenticSafeRouting({
  origin,
  risk: { ...baseRisk, riskScore: 95, riskLevel: 'EXTREME' },
  pfz,
});
assert.equal(dangerous.status, 'ROUTE_BLOCKED');
assert.equal(dangerous.decision.decision, 'AVOID');
assert.equal(dangerous.route, undefined);
console.log('✓ Decision Fusion blocks routing for EXTREME risk.');

const noDestination = runAgenticSafeRouting({ origin, risk: baseRisk });
assert.equal(noDestination.status, 'ROUTE_NOT_REQUESTED');
assert.equal(noDestination.route, undefined);
console.log('✓ Routing remains optional when no PFZ or explicit destination exists.');

console.log('--- ALL AGENTIC SAFE ROUTING TESTS PASSED ---');
