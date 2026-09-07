import type { GeofenceSpatialAnalysis, RiskPrediction } from '../../src/types.ts';
import type { PfzAnalysis, PfzZone } from './pfzService.ts';

export type OperationalDecision = 'PROCEED' | 'CAUTION' | 'AVOID' | 'UNAVAILABLE';
export type DecisionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';

export interface DecisionFusionResult {
  decision: OperationalDecision;
  confidence: DecisionConfidence;
  score: number;
  rationale: string;
  factors: string[];
  warnings: string[];
  selectedZone?: string;
}

function confidenceFor(risk: RiskPrediction, pfz?: PfzAnalysis): DecisionConfidence {
  if (!pfz) return risk.confidenceScore >= 80 ? 'HIGH' : risk.confidenceScore >= 60 ? 'MEDIUM' : 'LOW';
  if (pfz.status === 'UNAVAILABLE') return 'LOW';
  const pfzConfidence = pfz.bestZone?.confidence;
  if (risk.confidenceScore >= 80 && pfzConfidence === 'HIGH' && pfz.status === 'READY') return 'HIGH';
  if (risk.confidenceScore >= 60 && (pfzConfidence === 'HIGH' || pfzConfidence === 'MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

function bestAccessibleZone(pfz?: PfzAnalysis): PfzZone | undefined {
  if (!pfz) return undefined;
  return pfz.zones.find((zone) => zone.geofenceStatus !== 'RESTRICTED' && zone.suitability !== 'LOW');
}

export function fuseMarineDecision(
  risk: RiskPrediction,
  geofence?: GeofenceSpatialAnalysis,
  pfz?: PfzAnalysis,
): DecisionFusionResult {
  const warnings: string[] = [];
  const factors: string[] = [];
  const restricted = Boolean(geofence?.inRestrictedWaters || geofence?.status === 'RESTRICTED_BREACH');
  const accessibleZone = bestAccessibleZone(pfz);
  const selectedZone = accessibleZone ?? pfz?.bestZone;
  let score = 100 - risk.riskScore;

  factors.push(`Marine safety risk: ${risk.riskLevel} (${risk.riskScore}/100).`);

  if (restricted) {
    score = 0;
    factors.push('Authoritative geofence indicates restricted or breached waters.');
    warnings.push('Do not operate in restricted waters; authoritative maritime boundaries take precedence over environmental suitability.');
  } else if (geofence?.status === 'CAUTION') {
    score -= 20;
    factors.push('Authoritative geofence indicates proximity/caution around a protected or restricted feature.');
    warnings.push('Verify official nautical charts and protected-area rules before operating.');
  } else if (geofence) {
    factors.push('Authoritative geofence check is clear at the operating point.');
  }

  if (risk.riskLevel === 'EXTREME') {
    score = 0;
    warnings.push('Extreme marine risk overrides PFZ potential.');
  } else if (risk.riskLevel === 'HIGH') {
    score = Math.min(score, 35);
    warnings.push('High marine risk overrides an otherwise favorable fishing signal.');
  } else if (risk.riskLevel === 'MODERATE') {
    score = Math.min(score, 65);
    factors.push('Moderate risk limits the operational recommendation.');
  }

  if (pfz && !restricted) {
    if (pfz.status === 'UNAVAILABLE') {
      warnings.push('PFZ observations are unavailable; no positive fishing recommendation is inferred.');
    } else if (selectedZone) {
      const suitabilityWeight = selectedZone.suitability === 'HIGH' ? 20 : selectedZone.suitability === 'MODERATE' ? 10 : 0;
      score = Math.min(100, Math.max(0, score * 0.8 + selectedZone.score * 0.2 + suitabilityWeight - (selectedZone.confidence === 'LOW' ? 10 : 0)));
      factors.push(`PFZ candidate ${selectedZone.id}: ${selectedZone.score}/100, ${selectedZone.suitability} suitability, ${selectedZone.confidence} confidence.`);
      if (selectedZone.confidence === 'LOW' || pfz.status === 'DEGRADED') warnings.push('PFZ evidence is degraded; treat environmental suitability as decision support rather than a strong recommendation.');
      if (selectedZone.geofenceStatus === 'RESTRICTED') warnings.push(`${selectedZone.id} is restricted and cannot be selected as an accessible fishing zone.`);
    } else {
      warnings.push('No accessible PFZ candidate met the positive suitability criteria.');
    }
  }

  const decision: OperationalDecision = restricted || risk.riskLevel === 'EXTREME' || risk.riskLevel === 'HIGH'
    ? 'AVOID'
    : pfz?.status === 'UNAVAILABLE' || !selectedZone || selectedZone.suitability === 'LOW' || pfz?.status === 'DEGRADED' || selectedZone.confidence === 'LOW'
      ? 'CAUTION'
      : score >= 70 && risk.riskLevel === 'LOW'
        ? 'PROCEED'
        : score >= 40
          ? 'CAUTION'
          : 'AVOID';

  // Hard safety overrides must remain numerically zero as well as AVOID.
  if (restricted || risk.riskLevel === 'EXTREME') score = 0;
  else if (risk.riskLevel === 'HIGH') score = Math.min(score, 35);

  score = Number(Math.min(100, Math.max(0, score)).toFixed(1));
  const confidence = confidenceFor(risk, pfz);
  const rationale = decision === 'PROCEED'
    ? 'Environmental potential is favorable enough for decision support and no overriding safety or geofence constraint was detected.'
    : decision === 'CAUTION'
      ? 'Some conditions are usable, but safety, evidence quality, PFZ uncertainty, or spatial constraints limit confidence.'
      : decision === 'AVOID'
        ? 'Safety or spatial constraints outweigh the environmental fishing potential.'
        : 'An operational decision cannot be safely established from the available evidence.';

  return { decision, confidence, score, rationale, factors, warnings: [...new Set(warnings)], selectedZone: selectedZone?.id };
}
