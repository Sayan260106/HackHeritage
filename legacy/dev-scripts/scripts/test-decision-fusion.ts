import { fuseMarineDecision } from '../server/services/decisionFusion.ts';

const risk = (riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME', riskScore: number, confidenceScore = 90) => ({
  riskLevel,
  riskScore,
  confidenceScore,
}) as any;

const geofence = (status: 'CLEAR' | 'CAUTION' | 'RESTRICTED_BREACH', inRestrictedWaters = false) => ({
  status,
  inRestrictedWaters,
  activeAlerts: [],
  operatingCoordinates: { latitude: 15, longitude: 73 },
  timestamp: new Date().toISOString(),
}) as any;

const pfz = (status: 'READY' | 'DEGRADED' | 'UNAVAILABLE', suitability: 'HIGH' | 'MODERATE' | 'LOW', confidence: 'HIGH' | 'MEDIUM' | 'LOW') => ({
  status,
  bestZone: { id: 'PFZ-1', score: 82, suitability, confidence, geofenceStatus: 'CLEAR' },
  zones: [{ id: 'PFZ-1', score: 82, suitability, confidence, geofenceStatus: 'CLEAR' }],
}) as any;

const ready = fuseMarineDecision(risk('LOW', 15), geofence('CLEAR'), pfz('READY', 'HIGH', 'HIGH'));
if (ready.decision !== 'PROCEED' || ready.confidence !== 'HIGH') throw new Error(`Expected high-confidence PROCEED, got ${ready.decision}/${ready.confidence}`);

const degraded = fuseMarineDecision(risk('LOW', 15), geofence('CLEAR'), pfz('DEGRADED', 'HIGH', 'LOW'));
if (degraded.decision !== 'CAUTION' || degraded.confidence !== 'LOW') throw new Error(`Expected degraded CAUTION/LOW, got ${degraded.decision}/${degraded.confidence}`);

const restricted = fuseMarineDecision(risk('LOW', 10), geofence('RESTRICTED_BREACH', true), pfz('READY', 'HIGH', 'HIGH'));
if (restricted.decision !== 'AVOID' || restricted.score !== 0) throw new Error(`Expected restricted AVOID/0, got ${restricted.decision}/${restricted.score}`);

const dangerous = fuseMarineDecision(risk('EXTREME', 95), geofence('CLEAR'), pfz('READY', 'HIGH', 'HIGH'));
if (dangerous.decision !== 'AVOID') throw new Error(`Expected extreme-risk AVOID, got ${dangerous.decision}`);

console.log('ORCA-X decision fusion tests passed:', {
  ready: { decision: ready.decision, confidence: ready.confidence, score: ready.score },
  degraded: { decision: degraded.decision, confidence: degraded.confidence, score: degraded.score },
  restricted: { decision: restricted.decision, confidence: restricted.confidence, score: restricted.score },
  dangerous: { decision: dangerous.decision, confidence: dangerous.confidence, score: dangerous.score },
});
