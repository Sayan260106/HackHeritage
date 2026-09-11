import type { LocationInfo, OperationalDecision, RiskPrediction } from '../../src/types.ts';
import { fuseMarineDecision } from './decisionFusion.ts';
import { calculateSafeRoute, type SafeRouteResult } from './safeRouting.ts';
import type { GeofenceSpatialAnalysis } from '../../src/types.ts';
import type { PfzAnalysis } from './pfzService.ts';
import { COASTAL_LOCATIONS } from '../../src/data/coastalData.ts';

export interface AgenticSafeRoutingRequest {
  origin: LocationInfo;
  risk: RiskPrediction;
  geofence?: GeofenceSpatialAnalysis;
  pfz?: PfzAnalysis;
  destination?: { latitude: number; longitude: number; label?: string };
  query?: string;
}

export interface AgenticSafeRoutingResult {
  decision: OperationalDecision;
  route?: SafeRouteResult;
  status: 'ROUTE_FOUND' | 'ROUTE_NOT_REQUESTED' | 'ROUTE_BLOCKED' | 'ROUTE_UNAVAILABLE';
  destinationLabel?: string;
  warnings: string[];
}

function resolveDestination(request: AgenticSafeRoutingRequest): { latitude: number; longitude: number; label: string } | undefined {
  if (request.destination) {
    return {
      latitude: request.destination.latitude,
      longitude: request.destination.longitude,
      label: request.destination.label || 'Designated Marine Waypoint',
    };
  }

  // 1. Potential Fishing Zone destination if available
  if (request.pfz?.bestZone) {
    return {
      latitude: request.pfz.bestZone.latitude,
      longitude: request.pfz.bestZone.longitude,
      label: request.pfz.bestZone.id,
    };
  }
  if (request.pfz?.zones && request.pfz.zones.length > 0) {
    return {
      latitude: request.pfz.zones[0].latitude,
      longitude: request.pfz.zones[0].longitude,
      label: request.pfz.zones[0].id,
    };
  }

  // If no query was passed and no pfz/destination was passed, routing was not requested
  if (!request.query || !request.query.trim()) {
    return undefined;
  }

  const query = request.query.toLowerCase();

  // 2. Named destination coastal station or port in query
  for (const [key, loc] of Object.entries(COASTAL_LOCATIONS)) {
    const cleanKey = key.replace(/_/g, ' ');
    if (loc.name !== request.origin.name && (query.includes(cleanKey) || query.includes(loc.name.toLowerCase()))) {
      return { latitude: loc.latitude, longitude: loc.longitude, label: loc.name };
    }
  }

  // 3. Port / harbor return intent
  if (/port|harbor|harbour|dock|base|return|refuge|haven|shelter|ফিরে|বন্দর|बंदरगाह/i.test(query)) {
    if (request.origin.nearestPort) {
      return {
        latitude: request.origin.latitude,
        longitude: request.origin.longitude,
        label: request.origin.nearestPort,
      };
    }
  }

  // 4. If query explicitly asked for navigation or safe route, supply fairway corridor
  if (/route|routing|navigate|navigation|path|corridor|waypoint|রাস্তা|দিক|दिशा|பாதை|దారి|വഴി/i.test(query)) {
    return {
      latitude: Number((request.origin.latitude + 0.12).toFixed(4)),
      longitude: Number((request.origin.longitude + 0.12).toFixed(4)),
      label: `${request.origin.name} Safe Navigation Fairway`,
    };
  }

  return undefined;
}

/**
 * Decision-first adapter for the agentic workflow.
 *
 * Routing never overrides Decision Fusion: AVOID/UNAVAILABLE decisions do not
 * produce a route. When a route is requested, the selected PFZ destination,
 * named port, or safe fairway is passed to the authoritative
 * geofence-aware routing engine.
 */
export function runAgenticSafeRouting(request: AgenticSafeRoutingRequest): AgenticSafeRoutingResult {
  const decision = fuseMarineDecision(request.risk, request.geofence, request.pfz);
  const warnings = [...decision.warnings];

  const destination = resolveDestination(request);

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
