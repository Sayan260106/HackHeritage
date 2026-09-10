import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { MarineSourceId } from './marineDataSource.ts';
import type { MarineObservation, MarineObservationVariable } from './marineObservation.ts';

export interface MarineSourceTelemetry {
  timestamp: string;
  latitude: number;
  longitude: number;
  sources: Array<{
    source: MarineSourceId;
    availability: MarineObservation['availability'];
    observedAt: string;
    ageHours: number;
    freshnessScore: number;
    completenessScore: number;
    qualityScore: number;
    missingVariables: MarineObservationVariable[];
    values: Partial<Record<MarineObservationVariable, number>>;
    warningCount: number;
  }>;
  fusedValues: Partial<Record<MarineObservationVariable, number>>;
  featureSources: Partial<Record<MarineObservationVariable, MarineSourceId>>;
  selectedSources: Partial<Record<'weather' | 'ocean', MarineSourceId>>;
  sourceScores: Partial<Record<MarineSourceId, number>>;
  dataQuality: 'LIVE' | 'DEGRADED' | 'UNAVAILABLE';
  disagreements: Array<{ variable: MarineObservationVariable; spread: number }>;
  warnings: string[];
}

const MAX_EVENTS = Math.max(50, Number(process.env.REALTIME_TELEMETRY_MAX_EVENTS || 500));
const STORE_PATH = resolve(process.env.ORCA_TELEMETRY_PATH || 'data/realtime/marine_telemetry.jsonl');
const events: MarineSourceTelemetry[] = [];
let loaded = false;

function loadPersisted(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(STORE_PATH)) return;
    const lines = readFileSync(STORE_PATH, 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(-MAX_EVENTS)) {
      try {
        const parsed = JSON.parse(line) as MarineSourceTelemetry;
        if (parsed?.timestamp && Array.isArray(parsed.sources)) events.push(parsed);
      } catch {
        // Ignore one corrupt telemetry record rather than breaking the live pipeline.
      }
    }
  } catch (error) {
    console.warn(`Marine telemetry persistence unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function recordMarineTelemetry(event: MarineSourceTelemetry): void {
  loadPersisted();
  events.push(event);
  const exceededCapacity = events.length > MAX_EVENTS;
  if (exceededCapacity) events.splice(0, events.length - MAX_EVENTS);

  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    if (exceededCapacity) {
      writeFileSync(STORE_PATH, `${events.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
    } else {
      appendFileSync(STORE_PATH, `${JSON.stringify(event)}\n`, 'utf8');
    }
  } catch (error) {
    console.warn(`Marine telemetry write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function getMarineTelemetry(limit = 50): MarineSourceTelemetry[] {
  loadPersisted();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), MAX_EVENTS);
  return events.slice(-safeLimit).reverse();
}

export function getMarineTelemetrySummary() {
  loadPersisted();
  const latest = events.at(-1);
  const providerCounts: Record<string, number> = {};
  let degradedEvents = 0;
  let disagreementEvents = 0;
  for (const event of events) {
    for (const source of event.sources) providerCounts[source.source] = (providerCounts[source.source] || 0) + 1;
    if (event.sources.some((source) => source.availability !== 'LIVE')) degradedEvents += 1;
    if (event.disagreements.length > 0) disagreementEvents += 1;
  }
  return {
    bufferedEvents: events.length,
    maxEvents: MAX_EVENTS,
    persistencePath: STORE_PATH,
    degradedEvents,
    disagreementEvents,
    providerObservations: providerCounts,
    latestTimestamp: latest?.timestamp || null,
    latestSelectedSources: latest?.selectedSources || null,
    latestFeatureSources: latest?.featureSources || null,
    latestDataQuality: latest?.dataQuality || null,
  };
}

const ANALYSIS_VARIABLES: MarineObservationVariable[] = [
  'windSpeedKts', 'windGustKts', 'waveHeightMeters', 'wavePeriodSec',
  'swellHeightMeters', 'swellPeriodSec', 'seaSurfaceTemperatureC',
];

export function getMarineTelemetryAnalysis() {
  loadPersisted();
  const sourceStats = new Map<MarineSourceId, { observations: number; live: number; meanQuality: number; missing: number }>();
  const pairStats = new Map<string, { samples: number; absError: number; signedError: number; relativeError: number }>();

  for (const event of events) {
    for (const source of event.sources) {
      const stats = sourceStats.get(source.source) || { observations: 0, live: 0, meanQuality: 0, missing: 0 };
      stats.observations += 1;
      stats.live += source.availability === 'LIVE' ? 1 : 0;
      stats.meanQuality += source.qualityScore;
      stats.missing += source.missingVariables.length;
      sourceStats.set(source.source, stats);
    }

    for (let i = 0; i < event.sources.length; i += 1) {
      for (let j = i + 1; j < event.sources.length; j += 1) {
        const left = event.sources[i];
        const right = event.sources[j];
        const pair = [left.source, right.source].sort().join('__');
        const stats = pairStats.get(pair) || { samples: 0, absError: 0, signedError: 0, relativeError: 0 };
        for (const variable of ANALYSIS_VARIABLES) {
          const a = left.values[variable];
          const b = right.values[variable];
          if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) continue;
          const denominator = Math.max(Math.abs(b), 0.1);
          stats.samples += 1;
          stats.absError += Math.abs(a - b);
          stats.signedError += a - b;
          stats.relativeError += Math.abs(a - b) / denominator;
        }
        pairStats.set(pair, stats);
      }
    }
  }

  return {
    eventCount: events.length,
    sources: Object.fromEntries([...sourceStats.entries()].map(([source, stats]) => [source, {
      observations: stats.observations,
      liveRate: stats.observations ? Number((stats.live / stats.observations).toFixed(4)) : 0,
      meanQuality: stats.observations ? Number((stats.meanQuality / stats.observations).toFixed(4)) : 0,
      meanMissingVariables: stats.observations ? Number((stats.missing / stats.observations).toFixed(2)) : 0,
    }])),
    pairwiseBias: Object.fromEntries([...pairStats.entries()].map(([pair, stats]) => [pair, {
      samples: stats.samples,
      meanAbsoluteDifference: stats.samples ? Number((stats.absError / stats.samples).toFixed(4)) : null,
      meanSignedDifference: stats.samples ? Number((stats.signedError / stats.samples).toFixed(4)) : null,
      meanRelativeDifference: stats.samples ? Number((stats.relativeError / stats.samples).toFixed(4)) : null,
    }])),
    interpretation: 'Pairwise differences are observational telemetry, not proof of sensor accuracy. Use them to identify distribution shift, missingness and source disagreement before retraining the ML model.',
  };
}
