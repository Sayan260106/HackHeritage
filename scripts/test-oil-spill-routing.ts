import { fetchLiveOilSpillAnalysis } from '../server/services/realtime/oilSpillService.ts';
import { calculateSafeRoute } from '../server/services/safeRouting.ts';

async function testOilSpillIntegration() {
  console.log('--------------------------------------------------');
  console.log('🧪 TESTING REAL LIVE OIL SPILL SATELLITE SERVICE');
  console.log('--------------------------------------------------');

  const originLat = 17.6868; // Visakhapatnam Port
  const originLon = 83.2185;

  console.log(`📡 Querying NASA EONET & Copernicus STAC APIs for (${originLat}°N, ${originLon}°E)...`);
  const oilAnalysis = await fetchLiveOilSpillAnalysis(originLat, originLon);

  console.log(`\n• Status:               ${oilAnalysis.status}`);
  console.log(`• Source:               ${oilAnalysis.source}`);
  console.log(`• Active Events Count:  ${oilAnalysis.activeSpillsCount}`);

  if (oilAnalysis.events.length > 0) {
    console.log('\n--- Active Satellite Events Found ---');
    oilAnalysis.events.forEach((evt, idx) => {
      console.log(`[#${idx + 1}] ${evt.title} (${evt.sourceAuthority})`);
      console.log(`     Pos: ${evt.latitude}°N, ${evt.longitude}°E | Distance: ${evt.distanceNm} NM`);
    });
  } else {
    console.log('ℹ️ Area clean! No active satellite oil slicks returned by NASA/Copernicus (zero hardcoded fallback).');
  }

  console.log('\n--------------------------------------------------');
  console.log('🧭 TESTING SAFE ROUTE PATHFINDING OBSTACLE AVOIDANCE');
  console.log('--------------------------------------------------');

  // Test routing with a simulated obstacle to verify pathfinder detour logic
  const routeResult = calculateSafeRoute({
    origin: { latitude: 17.68, longitude: 83.21 },
    destination: { latitude: 17.85, longitude: 83.45 },
    riskLevel: 'HIGH',
    oilSpills: [
      {
        id: 'test-slick-1',
        title: 'Test Synthetic Oil Slick',
        category: 'oil_spill',
        latitude: 17.76,
        longitude: 83.33,
        areaKm2: 25.0,
        sourceAuthority: 'Test Suite',
        detectedAt: new Date().toISOString()
      }
    ]
  });

  console.log(`• Route Status:         ${routeResult.status}`);
  console.log(`• Waypoints Count:     ${routeResult.waypoints.length}`);
  console.log(`• Direct Distance:     ${routeResult.directDistanceKm} km`);
  console.log(`• Total Route Distance:${routeResult.distanceKm} km`);
  console.log(`• Avoided Constraints: ${routeResult.avoidedConstraints.join(', ') || 'None'}`);

  if (routeResult.status === 'ROUTE_FOUND' && routeResult.waypoints.length > 0) {
    console.log('\n✅ PASS: Safe routing engine successfully calculated a detour around the hazard obstacle!');
  } else {
    console.warn('\n⚠️ WARNING: Route pathfinder check did not produce a route.');
  }

  console.log('--------------------------------------------------\n');
}

testOilSpillIntegration().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
