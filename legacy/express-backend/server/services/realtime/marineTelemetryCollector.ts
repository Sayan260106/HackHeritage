import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { COASTAL_LOCATIONS } from '../../../src/data/coastalData.ts';
import { fetchFusedRealtimeMarineObservation } from './marineDataFusion.ts';

const MOSDAC_CACHE_PATH = path.resolve(process.cwd(), 'data/realtime/mosdac_latest.json');
const MAX_MOSDAC_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
let mosdacSyncInProgress = false;

function checkAndRefreshMosdacTelemetry(): void {
  if (mosdacSyncInProgress) return;
  try {
    let shouldSync = false;
    if (!fs.existsSync(MOSDAC_CACHE_PATH)) {
      shouldSync = true;
    } else {
      const stats = fs.statSync(MOSDAC_CACHE_PATH);
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs > MAX_MOSDAC_AGE_MS) {
        shouldSync = true;
      }
    }

    if (shouldSync) {
      mosdacSyncInProgress = true;
      console.log('MOSDAC cache is stale or absent (>24h). Triggering automated background sync...');
      const proc = spawn('python', ['scripts/mosdac-daemon.py', '--once'], {
        stdio: 'ignore',
        detached: true,
        shell: process.platform === 'win32',
      });
      proc.unref();
      proc.on('close', () => {
        mosdacSyncInProgress = false;
      });
    }
  } catch (err) {
    mosdacSyncInProgress = false;
    console.warn('MOSDAC freshness verification notice:', err);
  }
}

export async function collectMarineTelemetrySnapshot(): Promise<void> {
  if (running) return;
  running = true;
  try {
    checkAndRefreshMosdacTelemetry();
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
