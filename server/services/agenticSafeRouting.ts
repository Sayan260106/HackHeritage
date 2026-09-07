import type { LocationInfo, OperationalDecision, RiskPrediction } from '../../src/types.ts';
import { fuseMarineDecision } from './decisionFusion.ts';
import { calculateSafeRoute, type SafeRouteResult } from './safeRouting.ts';
import type { GeofenceSpatialAnalysis } from '../../src/types.ts';
import type { PfzAnalysis } from './pfzService.ts';

export interface AgenticSafeRoutingRequest {
  origin: LocationInfo;
  risk: RiskPrediction;
  geofence?: GeofenceSpatialAnalysis;
  pfz?: PfzAnalysis;
  destination?: { latitude: number; longitude: number; label?: string };
}

export interface AgenticSafeRoutingResult {
  decision: OperationalDecision;
  route?: SafeRouteResult;
  status: 'ROUTE_FOUND' | 'ROUTE_NOT_REQUESTED' | 'ROUTE_BLOCKED' | 'ROUTE_UNAVAILABLE';
  destinationLabel?: string;
  warnings: string[];
}

/**
 * Decision-first adapter for the agentic workflow.
 *
 * Routing never overrides Decision Fusion: AVOID/UNAVAILABLE decisions do not
 * produce a route. When a route is requested, the selected PFZ destination (or
 * an explicitly supplied destination) is passed to the authoritative
 * geofence-aware routing engine.
 */
export function runAgenticSafeRouting(request: AgenticSafeRoutingRequest): AgenticSafeRoutingResult {
  const decision = fuseMarineDecision(request.risk, request.geofence, request.pfz);
  const warnings = [...decision.warnings];

  const destination = request.destination ?? (request.pfz?.bestZone
    ? { latitude: request.pfz.bestZone.latitude, longitude: request.pfz.bestZone.longitude, label: request.pfz.bestZone.id }
    : undefined);

  if (!destination) {
    return { decision, status: 'ROUTE_NOT_REQUESTED', warnings };
  }

  if (decision.decision === 'AVOID' || decision.decision === 'UNAVAILABLE') {
    warnings.push(`Safe routing withheld because Decision Fusion returned ${decision.decision}.`);
    return { decision, status: 'ROUTE_BLOCKED', destinationLabel: destination.label, warnings };
  }

  const route = calculateSafeRoute({
    origin: { latitude: request.origin.latitude, longitude: request.origin.longitude },
    destination: { latitude: destination.latitude, longitude: destination.longitude },
    riskLevel: request.risk.riskLevel,
  });
  warnings.push(...route.warnings);

  return {
    decision,
    route,
    status: route.status === 'ROUTE_FOUND' ? 'ROUTE_FOUND' : 'ROUTE_UNAVAILABLE',
    destinationLabel: destination.label,
    warnings: [...new Set(warnings)],
  };
}
