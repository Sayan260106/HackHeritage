import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';
import { createOrcaPlan } from '../server/services/agenticPlanner.ts';

async function runVesselSurveillanceAgentTests() {
  console.log('======================================================================');
  console.log('🚢 ORCA-X AGENTIC VESSEL SURVEILLANCE & AIS/SAR INTEGRATION TEST');
  console.log('======================================================================\n');

  // Test 1: Explicit Vessel Traffic Query (English)
  console.log('[Test 1] Evaluating English Maritime Traffic & Dark Vessel Query:');
  const query1 = 'Are there any suspicious dark vessels or ship traffic near Visakhapatnam?';
  const plan1 = createOrcaPlan(query1, 'en');

  const vesselsTask1 = plan1.tasks.find((t) => t.id === 'vessels');
  if (!vesselsTask1 || !vesselsTask1.enabled) {
    throw new Error(`[FAIL] Expected 'vessels' task to be enabled in plan for query: "${query1}"`);
  }
  console.log(`  ✓ Planner correctly enabled 'vessels' task with intent: ${plan1.intent}`);

  const response1 = await runOrcaAgentWorkflow(query1, 'visakhapatnam', undefined, 'en');

  if (!response1.vesselTraffic) {
    throw new Error(`[FAIL] Expected response1.vesselTraffic to be populated.`);
  }

  console.log(`  ✓ Tracked Targets: ${response1.vesselTraffic.totalTrackedVessels}`);
  console.log(`  ✓ Active AIS: ${response1.vesselTraffic.activeAisVessels}`);
  console.log(`  ✓ Dark Vessels Flagged: ${response1.vesselTraffic.darkVesselCount}`);
  console.log(`  ✓ Surveillance Source: ${response1.vesselTraffic.dataSource}`);
  console.log(`  ✓ Sentinel-1 Radar Pass: ${response1.vesselTraffic.sentinel1PassTime}`);

  const vesselTrace = response1.agentTraces.find((t) => t.agentName === 'VesselSurveillanceAgent');
  if (!vesselTrace || vesselTrace.status !== 'completed') {
    throw new Error(`[FAIL] Expected 'VesselSurveillanceAgent' trace to be completed.`);
  }
  console.log(`  ✓ Agent Trace verified: "${vesselTrace.outputSummary}"`);
  console.log(`  ✓ Grounded Summary Excerpt: "${response1.groundedSummary.slice(0, 120)}..."\n`);

  // Test 2: Negation Suppression (User explicitly avoids vessel info)
  console.log('[Test 2] Evaluating Negation Suppression on Vessel Traffic:');
  const query2 = 'Check sea risk near Visakhapatnam without vessel traffic or ships';
  const plan2 = createOrcaPlan(query2, 'en');
  const vesselsTask2 = plan2.tasks.find((t) => t.id === 'vessels');
  if (vesselsTask2 && vesselsTask2.enabled) {
    throw new Error(`[FAIL] Expected 'vessels' task to be disabled via negation suppression for: "${query2}"`);
  }
  console.log(`  ✓ Negation suppression successfully disabled 'vessels' branch.\n`);

  // Test 3: Multilingual Support (Bengali Vessel Traffic Query)
  console.log('[Test 3] Evaluating Multilingual Vessel Surveillance (Bengali):');
  const query3 = 'দীঘা উপকূলে কি কোন জাহাজ বা ট্রলার চলাচল করছে?';
  const plan3 = createOrcaPlan(query3, 'bn');
  const vesselsTask3 = plan3.tasks.find((t) => t.id === 'vessels');
  if (!vesselsTask3 || !vesselsTask3.enabled) {
    throw new Error(`[FAIL] Expected 'vessels' task to be enabled for Bengali query: "${query3}"`);
  }
  console.log(`  ✓ Planner enabled 'vessels' branch for Bengali intent.`);

  const response3 = await runOrcaAgentWorkflow(query3, 'digha', undefined, 'bn');
  if (!response3.vesselTraffic || response3.vesselTraffic.totalTrackedVessels === 0) {
    throw new Error(`[FAIL] Expected non-empty vessel targets for Digha sector.`);
  }
  console.log(`  ✓ Bengali Briefing Generated: "${response3.groundedSummary.slice(0, 110)}..."\n`);

  console.log('======================================================================');
  console.log('✔ ALL AGENTIC VESSEL SURVEILLANCE INTEGRATION TESTS PASSED!');
  console.log('======================================================================');
}

runVesselSurveillanceAgentTests().catch((err) => {
  console.error('[FAIL] Vessel Surveillance Agent test failed:', err);
  process.exit(1);
});
