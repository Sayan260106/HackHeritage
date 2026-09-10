import { getIncoisDailyPfzFeatures, findNearestIncoisPfzZones } from '../server/services/realtime/incoisPfzService.ts';

async function main() {
  console.log('=== TESTING OFFICIAL INCOIS SATELLITE PFZ SERVICE ===');
  const fc = await getIncoisDailyPfzFeatures();
  console.log('Total INCOIS Features loaded:', fc.features.length);

  const testPorts = [
    { name: 'Digha (WB)', lat: 21.6266, lon: 87.5074 },
    { name: 'Paradeep (Odisha)', lat: 20.2644, lon: 86.6947 },
    { name: 'Chennai (TN)', lat: 13.0827, lon: 80.2707 },
    { name: 'Kochi (Kerala)', lat: 9.9312, lon: 76.2673 },
  ];

  for (const port of testPorts) {
    const zones = await findNearestIncoisPfzZones(port.lat, port.lon, 2);
    console.log(`\n--- Port: ${port.name} ---`);
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      console.log(`  Zone #${i + 1}: INCOIS UID=${z.uid} | Distance=${z.distanceNm} NM (${z.distanceKm} km) | Heading=${z.bearingDeg}° | Front Length=${z.frontLengthKm} km | Closest Intercept=[${z.closestLat}°N, ${z.closestLon}°E]`);
    }
  }
}

main().catch(console.error);
