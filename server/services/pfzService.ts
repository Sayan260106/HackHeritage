import { fetchRealOceanMetricsGrid, type RealOceanMetrics } from '../../src/services/satellite/realOceanColorService.ts';
import type { LocationInfo, RiskPrediction } from '../../src/types.ts';
import { fuseMarineDecision, type DecisionFusionResult } from './decisionFusion.ts';
import { analyzeMaritimeGeofencing } from './geofenceService.ts';

export type PfzConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
export type PfzSuitability = 'HIGH' | 'MODERATE' | 'LOW';

export interface PfzZone {
  id: string;
  rank: number;
  latitude: number;
  longitude: number;
  score: number;
  suitability: PfzSuitability;
  confidence: PfzConfidence;
  chlorophyllMgM3?: number;
  sstC?: number;
  sstAnomalyC?: number;
  thermalFrontDetected?: boolean;
  algalBloomDetected?: boolean;
  riskLevel?: RiskPrediction['riskLevel'];
  geofenceStatus: 'CLEAR' | 'CAUTION' | 'RESTRICTED';
  explanations: string[];
  warnings: string[];
  sources: string[];
}

export interface PfzAnalysis {
  status: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  generatedAt: string;
  location: LocationInfo;
  zones: PfzZone[];
  bestZone?: PfzZone;
  methodology: string;
  dataQuality: {
    chlorophyll: 'AVAILABLE' | 'MISSING';
    sst: 'AVAILABLE' | 'MISSING';
    sstAnomaly: 'AVAILABLE' | 'MISSING';
    thermalFront: 'AVAILABLE' | 'MISSING';
    risk: 'AVAILABLE' | 'MISSING';
    geofence: 'AVAILABLE' | 'MISSING';
  };
  warnings: string[];
  decision: DecisionFusionResult;
}

const PROBE_OFFSETS: Array<[number, number]> = [
  [0.10, 0.16],
  [-0.10, 0.16],
  [0.14, 0.28],
  [-0.14, 0.28],
];

function scoreChlorophyll(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value >= 0.8 && value < 2.0) return 30;
  if (value >= 2.0 && value < 5.0) return 22;
  if (value >= 0.6) return 18;
  return 6;
}

function scoreThermalFront(metrics: RealOceanMetrics): number {
  return metrics.thermalFrontDetected === true ? 25 : metrics.thermalFrontDetected === false ? 5 : 0;
}

function scoreSst(metrics: RealOceanMetrics): number {
  if (typeof metrics.sstC !== 'number' || !Number.isFinite(metrics.sstC)) return 0;
  if (metrics.sstC >= 24 && metrics.sstC <= 30) return 20;
  if (metrics.sstC >= 22 && metrics.sstC <= 32) return 12;
  return 5;
}

function scoreSstAnomaly(metrics: RealOceanMetrics): number {
  if (typeof metrics.sstAnomalyC !== 'number' || !Number.isFinite(metrics.sstAnomalyC)) return 0;
  const magnitude = Math.abs(metrics.sstAnomalyC);
  if (magnitude >= 0.5 && magnitude <= 1.5) return 10;
  if (magnitude < 0.5) return 5;
  return 2;
}

function scoreRisk(risk?: RiskPrediction): number {
  if (!risk) return 0;
  switch (risk.riskLevel) {
    case 'LOW': return 10;
    case 'MODERATE': return 6;
    case 'HIGH': return 2;
    case 'EXTREME': return 0;
  }
}

export function calculatePfzScore(metrics: RealOceanMetrics, risk?: RiskPrediction): number {
  return Number(Math.min(100, Math.max(0,
    scoreChlorophyll(metrics.chlorophyllConcentrationMgM3) +
    scoreThermalFront(metrics) +
    scoreSst(metrics) +
    scoreSstAnomaly(metrics) +
    scoreRisk(risk)
  )).toFixed(1));
}

function buildZone(
  index: number,
  location: LocationInfo,
  metrics: RealOceanMetrics,
  risk?: RiskPrediction,
  geofenceRestricted = false,
  geofenceCaution = false,
): PfzZone {
  const score = calculatePfzScore(metrics, risk);
  const suitability: PfzSuitability = geofenceRestricted || risk?.riskLevel === 'EXTREME'
    ? 'LOW'
    : score >= 70 ? 'HIGH' : score >= 45 ? 'MODERATE' : 'LOW';

  const explanations: string[] = [];
  if (typeof metrics.chlorophyllConcentrationMgM3 === 'number') {
    explanations.push(metrics.chlorophyllConcentrationMgM3 >= 0.8
      ? `Elevated chlorophyll-a (${metrics.chlorophyllConcentrationMgM3.toFixed(2)} mg/m³) supports biological productivity.`
      : `Chlorophyll-a (${metrics.chlorophyllConcentrationMgM3.toFixed(2)} mg/m³) is not strongly elevated.`);
  }
  if (metrics.thermalFrontDetected === true) explanations.push('A thermal-front signal is detected and is used as a productivity indicator.');
  if (typeof metrics.sstC === 'number') explanations.push(`Sea-surface temperature is ${metrics.sstC.toFixed(1)}°C and is included as a habitat-suitability signal.`);
  if (typeof metrics.sstAnomalyC === 'number') explanations.push(`SST anomaly is ${metrics.sstAnomalyC >= 0 ? '+' : ''}${metrics.sstAnomalyC.toFixed(2)}°C and contributes to the PFZ score.`);
  if (risk) explanations.push(`Marine safety risk is ${risk.riskLevel}; navigation safety takes precedence over fishing potential.`);
  if (geofenceRestricted) explanations.push('This candidate intersects restricted maritime waters and is excluded from a positive fishing recommendation.');
  else if (geofenceCaution) explanations.push('This candidate is near a protected/restricted maritime feature; verify official charts before operating.');

  const warnings: string[] = [];
  if (metrics.algalBloomDetected === true) warnings.push(metrics.algalBloomReason ?? 'Elevated chlorophyll may indicate an algal bloom; check official ecological advisories.');
  if (risk?.riskLevel === 'HIGH' || risk?.riskLevel === 'EXTREME') warnings.push('Safety risk takes precedence over PFZ suitability.');
  if (geofenceRestricted) warnings.push('Restricted maritime area: do not treat this zone as an accessible PFZ.');
  if (geofenceCaution) warnings.push('Geofence proximity warning: verify authoritative maritime boundaries and protected-area rules.');

  const sources = [...metrics.sourcesUsed];
  if (risk) sources.push(`ORCA-X ${risk.modelVersion} marine risk model`);
  const availableSignals = [metrics.chlorophyllConcentrationMgM3, metrics.sstC, metrics.sstAnomalyC, metrics.thermalFrontDetected]
    .filter((value) => value !== undefined).length;
  const confidence: PfzConfidence = geofenceRestricted
    ? 'LOW'
    : availableSignals >= 3 ? 'HIGH' : availableSignals >= 2 ? 'MEDIUM' : availableSignals >= 1 ? 'LOW' : 'UNAVAILABLE';

  return {
    id: `PFZ-${index + 1}`,
    rank: index + 1,
    latitude: Number(location.latitude.toFixed(4)),
    longitude: Number(location.longitude.toFixed(4)),
    score,
    suitability,
    confidence,
    chlorophyllMgM3: metrics.chlorophyllConcentrationMgM3,
    sstC: metrics.sstC,
    sstAnomalyC: metrics.sstAnomalyC,
    thermalFrontDetected: metrics.thermalFrontDetected,
    algalBloomDetected: metrics.algalBloomDetected,
    riskLevel: risk?.riskLevel,
    geofenceStatus: geofenceRestricted ? 'RESTRICTED' : geofenceCaution ? 'CAUTION' : 'CLEAR',
    explanations,
    warnings,
    sources: [...new Set(sources)],
  };
}

export async function analyzePfz(
  location: LocationInfo,
  risk?: RiskPrediction,
  geofence?: { inRestrictedWaters?: boolean; activeAlerts?: Array<{ severity?: string }> },
): Promise<PfzAnalysis> {
  const candidates = [
    { latitude: location.latitude, longitude: location.longitude },
    ...PROBE_OFFSETS.map(([dLat, dLon]) => ({ latitude: location.latitude + dLat, longitude: location.longitude + dLon })),
  ];
  const metricsGrid = await fetchRealOceanMetricsGrid(candidates);

  const zones = candidates.map((candidate, index) => {
    const candidateLocation = { ...location, latitude: candidate.latitude, longitude: candidate.longitude };
    const spatialGeo = analyzeMaritimeGeofencing(candidate.latitude, candidate.longitude);
    const restricted = spatialGeo.inRestrictedWaters || (Boolean(geofence?.inRestrictedWaters) && index === 0);
    const caution = spatialGeo.status === 'CAUTION' || Boolean(geofence?.activeAlerts?.some((alert) => alert.severity === 'ADVISORY' || alert.severity === 'PROXIMITY_WARNING'));
    return buildZone(index, candidateLocation, metricsGrid[index], risk, restricted, caution);
  });

  zones.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  zones.forEach((zone, index) => { zone.rank = index + 1; });

  const signalCount = metricsGrid.reduce((max, metrics) => Math.max(max, [
    metrics.chlorophyllConcentrationMgM3,
    metrics.sstC,
    metrics.sstAnomalyC,
    metrics.thermalFrontDetected,
  ].filter((value) => value !== undefined).length), 0);

  const spatiallyResolved = new Set(metricsGrid.map((metrics) => JSON.stringify({
    chla: metrics.chlorophyllConcentrationMgM3,
    sst: metrics.sstC,
    anomaly: metrics.sstAnomalyC,
    front: metrics.thermalFrontDetected,
  }))).size > 1;

  const warnings: string[] = [];
  if (signalCount === 0) warnings.push('No measured ocean-color or SST signals were available; PFZ ranking is unavailable rather than inferred from synthetic values.');
  else if (signalCount < 3) warnings.push('PFZ ranking is degraded because one or more oceanographic signals are unavailable.');
  if (!spatiallyResolved) warnings.push('All spatial probes returned equivalent observations; treat the ranking as low-spatial-resolution until independent measurements are available.');
  warnings.push('PFZ suitability is decision support, not a fish-catch guarantee; official fisheries advisories and maritime safety rules take precedence.');

  const status: PfzAnalysis['status'] = signalCount === 0 ? 'UNAVAILABLE' : signalCount < 3 ? 'DEGRADED' : 'READY';
  const provisionalAnalysis = {
    status,
    generatedAt: new Date().toISOString(),
    location,
    zones,
    bestZone: zones.find((zone) => zone.suitability !== 'LOW' && zone.geofenceStatus !== 'RESTRICTED') ?? zones[0],
    methodology: 'PFZ ranking combines independently measured chlorophyll-a, SST, SST anomaly/thermal-front signals, ORCA-X marine risk, and maritime geofence constraints. Missing observations are never replaced with synthetic values.',
    dataQuality: {
      chlorophyll: metricsGrid.some((metrics) => metrics.chlorophyllConcentrationMgM3 !== undefined) ? 'AVAILABLE' as const : 'MISSING' as const,
      sst: metricsGrid.some((metrics) => metrics.sstC !== undefined) ? 'AVAILABLE' as const : 'MISSING' as const,
      sstAnomaly: metricsGrid.some((metrics) => metrics.sstAnomalyC !== undefined) ? 'AVAILABLE' as const : 'MISSING' as const,
      thermalFront: metricsGrid.some((metrics) => metrics.thermalFrontDetected !== undefined) ? 'AVAILABLE' as const : 'MISSING' as const,
      risk: risk ? 'AVAILABLE' as const : 'MISSING' as const,
      geofence: geofence ? 'AVAILABLE' as const : 'MISSING' as const,
    },
    warnings,
  };

  const decision = risk
    ? fuseMarineDecision(risk, geofence as Parameters<typeof fuseMarineDecision>[1], provisionalAnalysis as PfzAnalysis)
    : {
        decision: 'UNAVAILABLE' as const,
        confidence: 'UNAVAILABLE' as const,
        score: 0,
        rationale: 'Marine risk is unavailable, so an operational fishing decision cannot be safely fused.',
        factors: ['Marine safety risk is unavailable.'],
        warnings: ['No operational fishing recommendation is inferred without marine risk.'],
      };

  return { ...provisionalAnalysis, decision };
}
