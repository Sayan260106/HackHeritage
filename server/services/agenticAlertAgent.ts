import { GeofenceSpatialAnalysis, OceanData, RiskLevel, RiskPrediction, WeatherData } from '../../src/types.ts';
import { AlertEvaluationResult, evaluateMarineAlerts } from './alertEngine.ts';

export interface AgenticAlertInput {
  weather: WeatherData;
  ocean: OceanData;
  risk: RiskPrediction;
  geofence?: GeofenceSpatialAnalysis;
  pfz?: { status?: string; bestZone?: { id: string; score: number; suitability?: string }; zones?: Array<{ id: string; score: number }> };
  previousRiskLevel?: RiskLevel;
  previousRiskScore?: number;
  previousPfzScore?: number;
  evaluatedAt?: string;
}

export interface AgenticAlertResult extends AlertEvaluationResult {
  decision: 'CLEAR' | 'MONITOR' | 'ACT';
  rationale: string;
  nextActions: string[];
}

/**
 * Agent-facing alert gate. The deterministic alert engine owns signal
 * detection; this layer turns those signals into an operational action state
 * that can be consumed by the planner/executor and final response grounding.
 * Previous risk/PFZ values are only used when supplied by a real state store;
 * the current workflow intentionally does not fabricate a previous state.
 */
export function runAgenticAlertEvaluation(input: AgenticAlertInput): AgenticAlertResult {
  const evaluation = evaluateMarineAlerts({
    ...input,
    previousRiskLevel: input.previousRiskScore === undefined ? undefined : input.previousRiskLevel,
    previousPfzScore: input.previousPfzScore,
  });
  const decision = evaluation.highestSeverity === 'CRITICAL'
    ? 'ACT'
    : evaluation.highestSeverity === 'WARNING' || evaluation.highestSeverity === 'ADVISORY'
      ? 'MONITOR'
      : 'CLEAR';

  const nextActions = evaluation.alerts
    .filter(alert => alert.actionable)
    .slice(0, 4)
    .map(alert => alert.actionable);

  const rationale = decision === 'ACT'
    ? `Critical marine alert(s) detected: ${evaluation.alerts.filter(alert => alert.severity === 'CRITICAL').map(alert => alert.title).join('; ')}.`
    : decision === 'MONITOR'
      ? `Marine conditions require monitoring because ${evaluation.alerts.length} advisory/warning signal(s) are active.`
      : 'No actionable marine alert threshold is currently active.';

  return { ...evaluation, decision, rationale, nextActions };
}
