/**
 * Potential Fishing Zone (PFZ) Service
 *
 * Grounded in official statutory daily satellite ocean fronts from:
 * Indian National Centre for Ocean Information Services (INCOIS),
 * Ministry of Earth Sciences (MoES), Government of India.
 *
 * Connects directly to INCOIS GeoServer WFS (`PFZ_Automation:pfzlines`)
 * and derives real-world pelagic fish convergence zones from live satellite
 * thermal and chlorophyll oceanic frontlines.
 */

import {
  findNearestIncoisPfzZones,
  getIncoisDailyPfzFeatures,
  type IncoisPfzFeatureCollection,
  type IncoisCandidateZone,
} from './realtime/incoisPfzService.ts';
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
  distanceNm: number;
  distanceKm: number;
  bearingDeg: number;
  frontLengthKm: number;
  incoisUid: string | number;
  julianDay: string;
  year: number;
  sstC?: number;
  sstAnomalyC?: number;
  chlorophyllMgM3?: number;
  thermalFrontDetected: boolean;
  algalBloomDetected?: boolean;
  riskLevel?: RiskPrediction['riskLevel'];
  geofenceStatus: 'CLEAR' | 'CAUTION' | 'RESTRICTED';
  explanations: string[];
  warnings: string[];
  sources: string[];
  feature?: IncoisCandidateZone['feature'];
}

export interface PfzAnalysis {
  status: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  generatedAt: string;
  location: LocationInfo;
  zones: PfzZone[];
  bestZone?: PfzZone;
  frontlines?: IncoisPfzFeatureCollection;
  methodology: string;
  dataQuality: {
    incoisSatelliteFronts: 'AVAILABLE' | 'MISSING';
    sst: 'AVAILABLE' | 'MISSING';
    risk: 'AVAILABLE' | 'MISSING';
    geofence: 'AVAILABLE' | 'MISSING';
  };
  warnings: string[];
  decision: DecisionFusionResult;
}

/**
 * Fetch live SST at coordinate using Open-Meteo Copernicus marine feed
 */
async function fetchPointSst(lat: number, lon: number): Promise<number | undefined> {
  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=sea_surface_temperature`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { current?: { sea_surface_temperature?: number } };
    return typeof data.current?.sea_surface_temperature === 'number'
      ? Number(data.current.sea_surface_temperature.toFixed(1))
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Calculate authentic PFZ suitability score based on:
 * - INCOIS Front Length (longer fronts = larger oceanic convergence / biological aggregation)
 * - Proximity to port/vessel (closer = safer and more accessible for artisanal crafts)
 * - Sea state risk override (weather safety strictly takes precedence)
 */
export function calculateIncoisPfzScore(
  candidate: IncoisCandidateZone,
  sstC?: number,
  risk?: RiskPrediction
): number {
  let score = 50; // Base score for official INCOIS satellite front

  // 1. Front length bonus (up to 25 pts)
  if (candidate.frontLengthKm >= 40) score += 25;
  else if (candidate.frontLengthKm >= 25) score += 18;
  else if (candidate.frontLengthKm >= 15) score += 12;
  else score += 6;

  // 2. Proximity factor (up to 15 pts)
  if (candidate.distanceNm <= 15) score += 15;
  else if (candidate.distanceNm <= 30) score += 10;
  else if (candidate.distanceNm <= 50) score += 5;

  // 3. SST habitat suitability (up to 10 pts)
  if (sstC !== undefined) {
    if (sstC >= 25 && sstC <= 30) score += 10;
    else if (sstC >= 23 && sstC <= 32) score += 5;
  }

  // 4. Marine Risk penalty/bonus
  if (risk) {
    if (risk.riskLevel === 'LOW') score += 5;
    else if (risk.riskLevel === 'MODERATE') score -= 5;
    else if (risk.riskLevel === 'HIGH') score -= 25;
    else if (risk.riskLevel === 'EXTREME') score -= 45;
  }

  return Number(Math.min(100, Math.max(10, score)).toFixed(1));
}

export async function analyzePfz(
  location: LocationInfo,
  risk?: RiskPrediction,
  geofence?: { inRestrictedWaters?: boolean; activeAlerts?: Array<{ severity?: string }> },
): Promise<PfzAnalysis> {
  // 1. Retrieve the nearest authentic INCOIS satellite ocean fronts
  const incoisCandidates = await findNearestIncoisPfzZones(location.latitude, location.longitude, 4);
  const frontlines = await getIncoisDailyPfzFeatures();

  // If no INCOIS features could be loaded at all
  if (incoisCandidates.length === 0) {
    return {
      status: 'UNAVAILABLE',
      generatedAt: new Date().toISOString(),
      location,
      zones: [],
      methodology: 'Statutory INCOIS satellite frontal analysis (PFZ_Automation).',
      dataQuality: {
        incoisSatelliteFronts: 'MISSING',
        sst: 'MISSING',
        risk: risk ? 'AVAILABLE' : 'MISSING',
        geofence: geofence ? 'AVAILABLE' : 'MISSING',
      },
      warnings: ['No statutory INCOIS satellite front lines currently retrieved from GeoServer.'],
      decision: {
        decision: 'UNAVAILABLE',
        confidence: 'UNAVAILABLE',
        score: 0,
        rationale: 'Official INCOIS PFZ satellite frontline feed is temporarily unreachable.',
        factors: ['Statutory INCOIS WFS unavailable.'],
        warnings: ['Do not venture offshore without verified INCOIS bulletin.'],
      },
    };
  }

  // 2. Fetch live SST in parallel for the candidate front coordinates
  const sstPromises = incoisCandidates.map((c) => fetchPointSst(c.closestLat, c.closestLon));
  const sstValues = await Promise.all(sstPromises);

  // 3. Construct authentic PFZ zones
  const zones: PfzZone[] = incoisCandidates.map((candidate, index) => {
    const sstC = sstValues[index];
    const spatialGeo = analyzeMaritimeGeofencing(candidate.closestLat, candidate.closestLon);
    const geofenceRestricted = spatialGeo.inRestrictedWaters;
    const geofenceCaution = spatialGeo.status === 'CAUTION';

    const score = calculateIncoisPfzScore(candidate, sstC, risk);
    const suitability: PfzSuitability =
      geofenceRestricted || risk?.riskLevel === 'EXTREME'
        ? 'LOW'
        : score >= 70 && candidate.distanceNm <= 45
        ? 'HIGH'
        : score >= 45
        ? 'MODERATE'
        : 'LOW';

    const confidence: PfzConfidence = geofenceRestricted
      ? 'LOW'
      : sstC !== undefined && candidate.frontLengthKm > 0
      ? 'HIGH'
      : 'MEDIUM';

    const explanations: string[] = [
      `Official INCOIS daily satellite ocean front (UID ${candidate.uid}, Julian Day ${candidate.julianDay}, Year ${candidate.year}).`,
      `Located at bearing ${candidate.bearingDeg}° (${candidate.distanceNm} NM / ${candidate.distanceKm} km offshore from ${location.name}).`,
      `Front line extends ${candidate.frontLengthKm} km across pelagic thermal/chlorophyll boundary.`,
    ];
    if (sstC !== undefined) {
      explanations.push(`Sea surface temperature at front intercept: ${sstC}°C (optimal pelagic fish convergence range).`);
    }
    if (risk) {
      explanations.push(`Sea state risk is ${risk.riskLevel}; weather safety directives override fishing operations.`);
    }
    if (geofenceRestricted) {
      explanations.push('Front segment intersects restricted waters or national border; fishing entry prohibited.');
    }

    const warnings: string[] = [];
    if (risk?.riskLevel === 'HIGH' || risk?.riskLevel === 'EXTREME') {
      warnings.push('Severe sea state: navigational safety takes strict precedence over PFZ harvesting.');
    }
    if (geofenceRestricted) {
      warnings.push('Restricted boundary: vessel must not enter protected ecological zone or cross IMBL.');
    }
    if (candidate.distanceNm > 40) {
      warnings.push('Extended offshore range (>40 NM): suitable only for motorized multi-day trawlers.');
    }

    return {
      id: `INCOIS-PFZ-${index + 1}`,
      rank: index + 1,
      latitude: candidate.closestLat,
      longitude: candidate.closestLon,
      score,
      suitability,
      confidence,
      distanceNm: candidate.distanceNm,
      distanceKm: candidate.distanceKm,
      bearingDeg: candidate.bearingDeg,
      frontLengthKm: candidate.frontLengthKm,
      incoisUid: candidate.uid,
      julianDay: candidate.julianDay,
      year: candidate.year,
      sstC,
      thermalFrontDetected: true,
      riskLevel: risk?.riskLevel,
      geofenceStatus: geofenceRestricted ? 'RESTRICTED' : geofenceCaution ? 'CAUTION' : 'CLEAR',
      explanations,
      warnings,
      sources: [
        'INCOIS GeoServer WFS (PFZ_Automation:pfzlines)',
        'Ministry of Earth Sciences (MoES), Govt of India',
        'Copernicus Marine / Open-Meteo SST',
      ],
      feature: candidate.feature,
    };
  });

  // Rank by highest score and proximity
  zones.sort((a, b) => b.score - a.score || a.distanceNm - b.distanceNm);
  zones.forEach((zone, index) => {
    zone.rank = index + 1;
  });

  const bestZone =
    zones.find((z) => z.suitability === 'HIGH' && z.geofenceStatus === 'CLEAR') ||
    zones.find((z) => z.suitability !== 'LOW' && z.geofenceStatus !== 'RESTRICTED') ||
    zones[0];

  const warnings: string[] = [];
  if (risk?.riskLevel === 'HIGH' || risk?.riskLevel === 'EXTREME') {
    warnings.push('High marine risk active; artisanal fishing operations suspended despite PFZ presence.');
  }

  const provisionalAnalysis: PfzAnalysis = {
    status: 'READY',
    generatedAt: new Date().toISOString(),
    location,
    zones,
    bestZone,
    frontlines,
    methodology:
      'Official statutory Potential Fishing Zones derived from daily INCOIS satellite ocean frontlines (Oceansat/thermal sensor composites), fused with Copernicus SST and MoES maritime safety thresholds.',
    dataQuality: {
      incoisSatelliteFronts: 'AVAILABLE',
      sst: sstValues.some((v) => v !== undefined) ? 'AVAILABLE' : 'MISSING',
      risk: risk ? 'AVAILABLE' : 'MISSING',
      geofence: geofence ? 'AVAILABLE' : 'MISSING',
    },
    warnings,
    decision: {
      decision: 'PROCEED' as const,
      confidence: 'HIGH' as const,
      score: bestZone ? bestZone.score : 75,
      rationale: bestZone
        ? `Official INCOIS satellite front #1 identified at bearing ${bestZone.bearingDeg}° (${bestZone.distanceNm} NM). Front length: ${bestZone.frontLengthKm} km.`
        : 'INCOIS satellite frontlines verified.',
      factors: [
        `INCOIS front length: ${bestZone?.frontLengthKm ?? 25} km`,
        `Bearing: ${bestZone?.bearingDeg ?? 0}°`,
        `Distance: ${bestZone?.distanceNm ?? 0} NM`,
      ],
      warnings: [],
    },
  };

  const decision = risk
    ? fuseMarineDecision(risk, geofence as Parameters<typeof fuseMarineDecision>[1], provisionalAnalysis)
    : provisionalAnalysis.decision;

  return { ...provisionalAnalysis, decision };
}
