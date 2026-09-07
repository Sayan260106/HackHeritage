import { COASTAL_LOCATIONS } from '../src/data/coastalData.ts';
import { analyzePfz } from '../server/services/pfzService.ts';

async function main() {
  const location = COASTAL_LOCATIONS.goa;
  const result = await analyzePfz(location);

  if (!['READY', 'DEGRADED', 'UNAVAILABLE'].includes(result.status)) {
    throw new Error(`Unexpected PFZ status: ${result.status}`);
  }
  if (result.zones.length === 0) {
    throw new Error('Expected at least 1 real INCOIS candidate zone.');
  }
  if (!result.zones.every((zone) => zone.score >= 0 && zone.score <= 100)) {
    throw new Error('PFZ scores must remain within 0-100.');
  }
  if (result.zones.some((zone, index) => zone.rank !== index + 1)) {
    throw new Error('PFZ ranks must be contiguous after sorting.');
  }
  if (!result.bestZone) throw new Error('PFZ analysis must expose a bestZone when candidates exist.');
  if (!result.methodology.includes('INCOIS')) {
    throw new Error('PFZ methodology must reference official statutory INCOIS data.');
  }
  if (!result.bestZone.incoisUid) {
    throw new Error('Best zone must contain an authentic INCOIS UID.');
  }

  console.log('ORCA-X PFZ intelligence tests passed:', {
    status: result.status,
    zones: result.zones.length,
    bestZone: result.bestZone.id,
    bestScore: result.bestZone.score,
    confidence: result.bestZone.confidence,
    dataQuality: result.dataQuality,
  });
}

main().catch((error) => {
  console.error('PFZ intelligence test failed:', error);
  process.exit(1);
});
