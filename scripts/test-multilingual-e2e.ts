import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';
import { LanguageCode } from '../src/types.ts';

interface MultilingualCase {
  id: string;
  lang: LanguageCode;
  langName: string;
  locationKey: string;
  query: string;
  expectedIntent: string;
}

const TEST_CASES: MultilingualCase[] = [
  {
    id: 'EN-1', lang: 'en', langName: 'English', locationKey: 'digha',
    query: 'What is the safest route for a fishing vessel considering weather and sea-state conditions?',
    expectedIntent: 'pfz_safe_routing',
  },
  {
    id: 'HI-1', lang: 'hi', langName: 'Hindi (हिन्दी)', locationKey: 'mumbai',
    query: 'क्या कल सुबह मुंबई के पास मछली पकड़ने के लिए समुद्र में जाना सुरक्षित है?',
    expectedIntent: 'marine_safety_fishing_advisory',
  },
  {
    id: 'BN-1', lang: 'bn', langName: 'Bengali (বাংলা)', locationKey: 'digha',
    query: 'দীঘার কাছে আজ সবচেয়ে কাছের সম্ভাব্য মাছ ধরার অঞ্চল (PFZ) কোথায়?',
    expectedIntent: 'potential_fishing_zone_intelligence',
  },
  {
    id: 'TA-1', lang: 'ta', langName: 'Tamil (தமிழ்)', locationKey: 'chennai',
    query: 'சென்னை அருகே ஏதேனும் புயல் அல்லது மின்னல் எச்சரிக்கைகள் உள்ளதா?',
    expectedIntent: 'marine_alert_intelligence',
  },
];

async function runMultilingualE2E() {
  console.log('========================================================================');
  console.log('🌊 ORCA-X END-TO-END MULTILINGUAL VERIFICATION (EN / HI / BN / TA)');
  console.log('========================================================================\n');

  let passed = 0;

  for (const tc of TEST_CASES) {
    console.log(`--- [${tc.id}] ${tc.langName} (${tc.lang.toUpperCase()}) ---`);
    console.log(`Query: "${tc.query}"`);
    console.log(`Location Key: ${tc.locationKey}`);

    try {
      const startTime = Date.now();
      const response = await runOrcaAgentWorkflow(tc.query, tc.locationKey, undefined, tc.lang);
      const elapsed = Date.now() - startTime;

      if (response.detectedIntent !== tc.expectedIntent) {
        throw new Error(`Expected intent ${tc.expectedIntent}, received ${response.detectedIntent}.`);
      }
      if (response.language !== tc.lang) {
        throw new Error(`Expected language ${tc.lang}, received ${response.language}.`);
      }
      if (!response.location?.name || !response.weather || !response.ocean || !response.risk) {
        throw new Error('Workflow returned incomplete required marine outputs.');
      }
      if (!response.executionPlan?.tasks?.some(task => task.status === 'completed' && task.id === 'synthesis')) {
        throw new Error('Synthesis task did not complete.');
      }

      console.log(`✓ Workflow Duration: ${elapsed}ms`);
      console.log(`✓ Detected Intent: ${response.detectedIntent}`);
      console.log(`✓ Resolved Location: ${response.location.name} (${response.location.latitude}, ${response.location.longitude})`);
      console.log(`✓ Weather: Wind ${response.weather.windSpeedKts} kts (${response.weather.source})`);
      console.log(`✓ Ocean: Wave ${response.ocean.waveHeightMeters}m (${response.ocean.source}) | Sea State: ${response.ocean.seaStateDescription}`);
      console.log(`✓ ML/Risk: Score ${response.risk.riskScore}/100 (${response.risk.riskLevel})`);
      console.log(`✓ Operational Decision: ${response.operationalDecision?.decision} (Confidence: ${response.operationalDecision?.confidence})`);
      console.log(`✓ Geofence Status: ${response.geofenceAnalysis?.status}`);

      if (response.safeRoute) {
        console.log(`✓ Safe Route: ${response.safeRoute.status} | Distance: ${response.safeRoute.distanceKm ?? 'N/A'} km | Waypoints: ${response.safeRoute.waypointCount}`);
      }

      console.log(`✓ Grounded Summary Length: ${response.groundedSummary.length} chars`);
      console.log(`✓ Summary Excerpt: "${response.groundedSummary.slice(0, 110).replace(/\n/g, ' ')}..."`);

      const tasks = response.executionPlan?.tasks || [];
      const completedTasks = tasks.filter(t => t.status === 'completed').map(t => t.id);
      console.log(`✓ Executed Agent Pipeline: [${completedTasks.join(' ➔ ')}]`);

      passed++;
      console.log(`✅ [${tc.id}] VERIFIED SUCCESSFULLY\n`);
    } catch (error) {
      console.error(`❌ [${tc.id}] FAILED:`, error);
    }
  }

  console.log('========================================================================');
  console.log(`🎉 COMPLETED: ${passed}/${TEST_CASES.length} Multilingual End-to-End Tests Passed!`);
  console.log('========================================================================');

  if (passed !== TEST_CASES.length) process.exit(1);
}

runMultilingualE2E();
