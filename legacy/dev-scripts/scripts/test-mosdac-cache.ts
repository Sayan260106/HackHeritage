import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const latitude = 21.6266;
const longitude = 87.5074;
const tempRoot = await mkdtemp(join(tmpdir(), 'orca-mosdac-test-'));
const cacheFile = join(tempRoot, 'mosdac_latest.json');

process.env.MOSDAC_REALTIME_CACHE_FILE = cacheFile;
process.env.MOSDAC_MAX_CACHE_STALENESS_HOURS = '36';
process.env.MOSDAC_MAX_CACHE_DISTANCE_DEG = '0.5';

const { mosdacCacheProvider } = await import('../server/services/realtime/mosdacCacheProvider.ts');

try {
  await writeFile(cacheFile, JSON.stringify({
    latitude,
    longitude,
    observedAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    values: { seaSurfaceTemperatureC: 28.4 },
  }), 'utf-8');

  const live = await mosdacCacheProvider.fetch(latitude, longitude);
  if (live.availability !== 'LIVE' || live.values?.seaSurfaceTemperatureC !== 28.4) {
    throw new Error(`Expected fresh MOSDAC cache to be LIVE: ${JSON.stringify(live)}`);
  }

  await writeFile(cacheFile, JSON.stringify({
    latitude,
    longitude,
    observedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    retrievedAt: new Date().toISOString(),
    values: { seaSurfaceTemperatureC: 28.4 },
  }), 'utf-8');

  const stale = await mosdacCacheProvider.fetch(latitude, longitude);
  if (stale.availability !== 'DEGRADED' || !stale.warnings.some(warning => warning.includes('stale'))) {
    throw new Error(`Expected stale MOSDAC cache to degrade: ${JSON.stringify(stale)}`);
  }

  await writeFile(cacheFile, JSON.stringify({
    latitude: latitude + 2,
    longitude,
    observedAt: new Date().toISOString(),
    retrievedAt: new Date().toISOString(),
    values: { seaSurfaceTemperatureC: 28.4 },
  }), 'utf-8');

  const distant = await mosdacCacheProvider.fetch(latitude, longitude);
  if (distant.availability !== 'DEGRADED' || !distant.warnings.some(warning => warning.includes('too far'))) {
    throw new Error(`Expected distant MOSDAC cache to degrade: ${JSON.stringify(distant)}`);
  }

  console.log('ORCA-X MOSDAC cache freshness tests passed:', {
    fresh: live.availability,
    stale: stale.availability,
    distant: distant.availability,
  });
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
