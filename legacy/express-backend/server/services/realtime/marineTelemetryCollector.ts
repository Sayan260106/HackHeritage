import { COASTAL_LOCATIONS } from '../../../src/data/coastalData.ts';
import { fetchFusedRealtimeMarineObservation } from './marineDataFusion.ts';

const COLLECTION_INTERVAL_MS = Math.max(60_000, Number(process.env.REALTIME_COLLECTION_INTERVAL_MS || 900_000));
const DEFAULT_LOCATION_KEYS = ['digha', 'paradeep', 'visakhapatnam', 'chennai', 'goa', 'kochi'];
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

function locationKeys(): string[] {
  const configured = (process.env.REALTIME_COLLECTION_LOCATIONS || DEFAULT_LOCATION_KEYS.join(','))
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  return configured.filter((key) => Boolean(COASTAL_LOCATIONS[key]));
}

export async function collectMarineTelemetrySnapshot(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const keys = locationKeys();
    const results = await Promise.allSettled(keys.map(async (key) => {
      const location = COASTAL_LOCATIONS[key];
      return fetchFusedRealtimeMarineObservation(location.latitude, location.longitude);
    }));
    const failures = results.filter((result) => result.status === 'rejected').length;
    console.log(`Marine telemetry collection: ${keys.length - failures}/${keys.length} locations completed${failures ? `; ${failures} failed` : ''}.`);
  } finally {
    running = false;
  }
}

export function startMarineTelemetryCollector(): void {
  const enabled = process.env.REALTIME_COLLECTION_ENABLED === 'true';
  if (!enabled || timer) return;

  console.log(`Marine telemetry collector enabled: interval=${COLLECTION_INTERVAL_MS}ms locations=${locationKeys().join(',') || 'none'}`);
  void collectMarineTelemetrySnapshot();
  timer = setInterval(() => void collectMarineTelemetrySnapshot(), COLLECTION_INTERVAL_MS);
  timer.unref?.();
}

export function stopMarineTelemetryCollector(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
