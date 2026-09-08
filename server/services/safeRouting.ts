import type { GeofenceSpatialAnalysis, OilSpillEvent, RiskLevel } from '../../src/types.ts';
import { analyzeMaritimeGeofencing, calculateBearingDeg, haversineDistanceKm } from './geofenceService.ts';

export interface RouteCoordinate {
  latitude: number;
  longitude: number;
}

export interface SafeRouteRequest {
  origin: RouteCoordinate;
  destination: RouteCoordinate;
  riskLevel?: RiskLevel;
  maxNodes?: number;
  oilSpills?: OilSpillEvent[];
}

export interface SafeRouteWaypoint extends RouteCoordinate {
  sequence: number;
  cumulativeDistanceKm: number;
  bearingDeg?: number;
  geofenceStatus: GeofenceSpatialAnalysis['status'];
}

export interface SafeRouteResult {
  status: 'ROUTE_FOUND' | 'ROUTE_UNAVAILABLE';
  origin: RouteCoordinate;
  destination: RouteCoordinate;
  distanceKm?: number;
  directDistanceKm: number;
  routeEfficiencyPct?: number;
  waypoints: SafeRouteWaypoint[];
  avoidedConstraints: string[];
  warnings: string[];
  rationale: string;
  source: string;
}

const EARTH_RADIUS_KM = 6371;
const DEFAULT_STEP_KM = 2;
const DEFAULT_MAX_NODES = 1800;
const MAX_GRID_RADIUS_KM = 80;

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

function normalizeLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}

function validateCoordinate(point: RouteCoordinate): void {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
    throw new Error('Origin and destination coordinates must contain finite latitude/longitude values within valid bounds.');
  }
}

function move(point: RouteCoordinate, northKm: number, eastKm: number): RouteCoordinate {
  const lat = point.latitude + northKm / 111.32;
  const cosLat = Math.max(0.2, Math.cos(toRadians(point.latitude)));
  return { latitude: lat, longitude: normalizeLongitude(point.longitude + eastKm / (111.32 * cosLat)) };
}

function key(row: number, col: number): string {
  return `${row}:${col}`;
}

interface GridNode {
  row: number;
  col: number;
  point: RouteCoordinate;
  blocked: boolean;
  cautionCost: number;
  geofence: GeofenceSpatialAnalysis;
}

function riskPenalty(riskLevel: RiskLevel = 'LOW'): number {
  return riskLevel === 'EXTREME' ? 120 : riskLevel === 'HIGH' ? 80 : riskLevel === 'MODERATE' ? 30 : 8;
}

function nodePenalty(node: GridNode, riskLevel: RiskLevel): number {
  if (node.blocked) return Infinity;
  const geofencePenalty = node.geofence.status === 'CAUTION' ? 35 : 0;
  return node.cautionCost + geofencePenalty + riskPenalty(riskLevel) * 0.03;
}

function isHardBlocked(geofence: GeofenceSpatialAnalysis): boolean {
  return geofence.activeAlerts.some(alert => alert.severity === 'CRITICAL_BREACH');
}

function segmentIsSafe(a: RouteCoordinate, b: RouteCoordinate): boolean {
  const distance = haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
  const samples = Math.max(2, Math.ceil(distance / 0.75));
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const point = {
      latitude: a.latitude + (b.latitude - a.latitude) * t,
      longitude: normalizeLongitude(a.longitude + (b.longitude - a.longitude) * t),
    };
    if (isHardBlocked(analyzeMaritimeGeofencing(point.latitude, point.longitude))) return false;
  }
  return true;
}

function reconstructPath(nodes: Map<string, GridNode>, cameFrom: Map<string, string>, currentKey: string): GridNode[] {
  const path: GridNode[] = [];
  let cursor = currentKey;
  while (true) {
    const node = nodes.get(cursor);
    if (!node) break;
    path.unshift(node);
    const previous = cameFrom.get(cursor);
    if (!previous) break;
    cursor = previous;
  }
  return path;
}

function nearestIndex(value: number, step: number): number {
  return Math.round(value / step);
}

/**
 * Deterministic risk-aware route search over a local coastal grid.
 * Authoritative geofence CRITICAL_BREACH nodes and segments are hard constraints;
 * CAUTION nodes are penalized rather than silently treated as forbidden.
 * This is decision support, not a replacement for an approved nautical routing system.
 */
export function calculateSafeRoute(request: SafeRouteRequest): SafeRouteResult {
  validateCoordinate(request.origin);
  validateCoordinate(request.destination);

  const directDistanceKm = haversineDistanceKm(
    request.origin.latitude,
    request.origin.longitude,
    request.destination.latitude,
    request.destination.longitude,
  );

  const destinationGeofence = analyzeMaritimeGeofencing(request.destination.latitude, request.destination.longitude);
  if (isHardBlocked(destinationGeofence)) {
    return {
      status: 'ROUTE_UNAVAILABLE',
      origin: request.origin,
      destination: request.destination,
      directDistanceKm: Number(directDistanceKm.toFixed(2)),
      waypoints: [],
      avoidedConstraints: destinationGeofence.activeAlerts.map(alert => alert.boundaryName),
      warnings: ['Destination is inside or critically intersecting an authoritative maritime geofence; no route is returned.'],
      rationale: 'Safe routing refuses to produce a route whose destination violates an authoritative maritime constraint.',
      source: 'ORCA-X deterministic safe-routing engine + authoritative maritime geofence dataset',
    };
  }

  const maxNodes = Math.max(800, Math.min(request.maxNodes ?? DEFAULT_MAX_NODES, 4500));
  
  // Adaptive step size based on direct distance so any operational route (up to 150 km) scales cleanly
  const stepKm = Math.max(1.5, Math.min(6.0, Number((directDistanceKm / 24).toFixed(2))));
  const bearing = calculateBearingDeg(request.origin.latitude, request.origin.longitude, request.destination.latitude, request.destination.longitude);
  const bearingRad = toRadians(bearing);
  const northDirect = directDistanceKm * Math.cos(bearingRad);
  const eastDirect = directDistanceKm * Math.sin(bearingRad);

  // Relative coordinate offsets in grid cells
  const deltaRow = Math.round(northDirect / stepKm);
  const deltaCol = Math.round(eastDirect / stepKm);
  const marginCells = Math.max(4, Math.round(12 / stepKm));

  // Determine grid dimensions ensuring origin and destination always fit with safety margin
  const rows = Math.min(55, Math.abs(deltaRow) + marginCells * 2 + 1);
  const cols = Math.min(55, Math.abs(deltaCol) + marginCells * 2 + 1);

  // Position origin so destination is safely bounded within grid extents
  const rowOrigin = deltaRow >= 0 ? marginCells : rows - 1 - marginCells;
  const colOrigin = deltaCol >= 0 ? marginCells : cols - 1 - marginCells;
  const rowDestination = rowOrigin + deltaRow;
  const colDestination = colOrigin + deltaCol;

  if (rowDestination < 0 || rowDestination >= rows || colDestination < 0 || colDestination >= cols || rows * cols > maxNodes) {
    return {
      status: 'ROUTE_UNAVAILABLE',
      origin: request.origin,
      destination: request.destination,
      directDistanceKm: Number(directDistanceKm.toFixed(2)),
      waypoints: [],
      avoidedConstraints: [],
      warnings: ['Route search window is too large for the deterministic local routing budget.'],
      rationale: 'The requested route exceeds the bounded local search area; no approximate route is fabricated.',
      source: 'ORCA-X deterministic safe-routing engine',
    };
  }

  const nodes = new Map<string, GridNode>();
  let avoidedOilSpillCount = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const north = (row - rowOrigin) * stepKm;
      const east = (col - colOrigin) * stepKm;
      const point = move(request.origin, north, east);
      const geofence = analyzeMaritimeGeofencing(point.latitude, point.longitude);
      
      let isOilSpillBlocked = false;
      if (Array.isArray(request.oilSpills) && request.oilSpills.length > 0) {
        for (const spill of request.oilSpills) {
          const dKm = haversineDistanceKm(point.latitude, point.longitude, spill.latitude, spill.longitude);
          if (dKm <= 6.5) {
            isOilSpillBlocked = true;
            avoidedOilSpillCount++;
            break;
          }
        }
      }

      const blocked = isHardBlocked(geofence) || isOilSpillBlocked;
      const cautionCost = geofence.status === 'CAUTION' ? 1 : 0;
      nodes.set(key(row, col), { row, col, point, blocked, cautionCost, geofence });
    }
  }

  const startKey = key(rowOrigin, colOrigin);
  const endKey = key(rowDestination, colDestination);
  const start = nodes.get(startKey);
  const end = nodes.get(endKey);
  if (!start || !end || start.blocked || end.blocked) {
    return {
      status: 'ROUTE_UNAVAILABLE',
      origin: request.origin,
      destination: request.destination,
      directDistanceKm: Number(directDistanceKm.toFixed(2)),
      waypoints: [],
      avoidedConstraints: [...new Set([...(start?.geofence.activeAlerts || []), ...(end?.geofence.activeAlerts || [])].map(alert => alert.boundaryName))],
      warnings: ['Origin or destination intersects a critical maritime geofence.'],
      rationale: 'Safe routing will not relax an authoritative geofence constraint to force a route.',
      source: 'ORCA-X deterministic safe-routing engine + authoritative maritime geofence dataset',
    };
  }

  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, directDistanceKm]]);
  const cameFrom = new Map<string, string>();
  const open = new Set<string>([startKey]);
  const neighbors = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  while (open.size) {
    let currentKey = [...open][0];
    for (const candidate of open) {
      if ((fScore.get(candidate) ?? Infinity) < (fScore.get(currentKey) ?? Infinity)) currentKey = candidate;
    }
    if (currentKey === endKey) break;
    open.delete(currentKey);
    const current = nodes.get(currentKey);
    if (!current) continue;

    for (const [dr, dc] of neighbors) {
      const nr = current.row + dr;
      const nc = current.col + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const neighborKey = key(nr, nc);
      const neighbor = nodes.get(neighborKey);
      if (!neighbor || neighbor.blocked) continue;
      if (!segmentIsSafe(current.point, neighbor.point)) continue;
      const moveDistance = haversineDistanceKm(current.point.latitude, current.point.longitude, neighbor.point.latitude, neighbor.point.longitude);
      const tentative = (gScore.get(currentKey) ?? Infinity) + moveDistance + nodePenalty(neighbor, request.riskLevel ?? 'LOW');
      if (tentative < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentative);
        fScore.set(neighborKey, tentative + haversineDistanceKm(neighbor.point.latitude, neighbor.point.longitude, request.destination.latitude, request.destination.longitude));
        open.add(neighborKey);
      }
    }
  }

  if (!cameFrom.has(endKey) && startKey !== endKey) {
    return {
      status: 'ROUTE_UNAVAILABLE',
      origin: request.origin,
      destination: request.destination,
      directDistanceKm: Number(directDistanceKm.toFixed(2)),
      waypoints: [],
      avoidedConstraints: [...new Set([...nodes.values()].filter(node => node.blocked).flatMap(node => node.geofence.activeAlerts.map(alert => alert.boundaryName)))],
      warnings: ['No geofence-safe path was found inside the bounded local search grid.'],
      rationale: 'All candidate corridors within the bounded search area intersect hard maritime constraints or exceed the routing budget.',
      source: 'ORCA-X deterministic safe-routing engine + authoritative maritime geofence dataset',
    };
  }

  const path = reconstructPath(nodes, cameFrom, endKey);
  const routePoints = path.map(node => node.point);
  if (routePoints.length) routePoints[routePoints.length - 1] = request.destination;
  let cumulative = 0;
  const waypoints: SafeRouteWaypoint[] = routePoints.map((point, index) => {
    if (index > 0) cumulative += haversineDistanceKm(routePoints[index - 1].latitude, routePoints[index - 1].longitude, point.latitude, point.longitude);
    const geofence = analyzeMaritimeGeofencing(point.latitude, point.longitude);
    return {
      ...point,
      sequence: index + 1,
      cumulativeDistanceKm: Number(cumulative.toFixed(2)),
      bearingDeg: index > 0 ? Math.round(calculateBearingDeg(routePoints[index - 1].latitude, routePoints[index - 1].longitude, point.latitude, point.longitude)) : undefined,
      geofenceStatus: geofence.status,
    };
  });

  const distanceKm = waypoints.at(-1)?.cumulativeDistanceKm ?? directDistanceKm;
  const cautionWaypoints = waypoints.filter(point => point.geofenceStatus === 'CAUTION').length;
  const avoidedConstraints = [...new Set([...nodes.values()].filter(node => node.blocked).flatMap(node => node.geofence.activeAlerts.map(alert => alert.boundaryName)))];
  const warnings = [
    ...(cautionWaypoints ? ['Route remains clear of critical geofences but passes through one or more caution corridors; verify official nautical charts.'] : []),
    ...((request.riskLevel === 'HIGH' || request.riskLevel === 'EXTREME') ? [`${request.riskLevel} modelled marine risk remains active; routing does not make the voyage safe.`] : []),
    'This route is decision support and must not replace official nautical charts, Notices to Mariners, COLREGS or competent local navigation.',
  ];

  return {
    status: 'ROUTE_FOUND',
    origin: request.origin,
    destination: request.destination,
    distanceKm: Number(distanceKm.toFixed(2)),
    directDistanceKm: Number(directDistanceKm.toFixed(2)),
    routeEfficiencyPct: Number(Math.min(100, (directDistanceKm / Math.max(directDistanceKm, distanceKm)) * 100).toFixed(1)),
    waypoints,
    avoidedConstraints,
    warnings,
    rationale: `Selected the lowest-cost geofence-safe corridor in the local search grid${cautionWaypoints ? ' while penalizing caution corridors' : ''}.`,
    source: 'ORCA-X deterministic safe-routing engine + authoritative maritime geofence dataset',
  };
}
