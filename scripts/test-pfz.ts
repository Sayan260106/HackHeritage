import { COASTAL_LOCATIONS } from '../src/data/coastalData.ts';
import { analyzePfz } from '../server/services/pfzService.ts';

async function main() {
  const location = COASTAL_LOCATIONS.goa;
  const result = await analyzePfz(location);

  if (!['READY', 'DEGRADED', 'UNAVAILABLE'].includes(result.status)) {
    throw new Error(`Unexpected PFZ status: ${result.status}`);
  }
  if (result.zones.length !== 5) {
    throw new Error(`Expected 5 deterministic candidate zones, got ${result.zones.length}`);
  }
  if (!result.zones.every((zone) => zone.score >= 0 && zone.score <= 100)) {
    throw new Error('PFZ scores must remain within 0-100.');
  }
  if (result.zones.some((zone, index) => zone.rank !== index + 1)) {
    throw new Error('PFZ ranks must be contiguous after sorting.');
  }
  if (!result.bestZone) throw new Error('PFZ analysis must expose a bestZone when candidates exist.');
  if (!result.methodology.includes('Missing observations are never replaced with synthetic values')) {
    throw new Error('PFZ methodology must explicitly reject synthetic observations.');
  }
  if (!result.warnings.some((warning) => warning.includes('fish-catch guarantee'))) {
    throw new Error('PFZ safety disclaimer is missing.');
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
