import assert from 'node:assert';
import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';
import { getSession, getOrCreateSession } from '../server/services/conversationService.ts';

async function testConversationSession() {
  console.log('=== Testing ORCA-X Multi-Turn Conversational Memory ===\n');

  const session = getOrCreateSession(undefined);
  const sessionId = session.sessionId;
  console.log(`Created session: ${sessionId}`);

  // Turn 1: Explicit initial location
  console.log('\n--- Turn 1: "Is it safe to venture into sea near Visakhapatnam right now?" ---');
  const turn1 = await runOrcaAgentWorkflow(
    'Is it safe to venture into sea near Visakhapatnam right now?',
    undefined,
    undefined,
    'en',
    sessionId
  );
  assert.strictEqual(turn1.location.name.toLowerCase().includes('visakhapatnam'), true, 'Turn 1 must resolve Visakhapatnam');
  assert.strictEqual(turn1.sessionId, sessionId, 'Response must carry sessionId');
  assert.strictEqual(turn1.turnIndex, 1, 'Turn index must be 1');
  console.log(`✓ Turn 1 resolved location: ${turn1.location.name} (Risk: ${turn1.risk.riskLevel})`);

  // Turn 2: Contextual follow-up WITHOUT mentioning location
  console.log('\n--- Turn 2: "What about tomorrow morning?" (Implicit location inheritance) ---');
  const turn2 = await runOrcaAgentWorkflow(
    'What about tomorrow morning?',
    undefined,
    undefined,
    'en',
    sessionId
  );
  assert.strictEqual(turn2.location.name.toLowerCase().includes('visakhapatnam'), true, 'Turn 2 must retain Visakhapatnam from Turn 1');
  assert.strictEqual(turn2.timeWindow.isForecast, true, 'Turn 2 must be forecast window');
  assert.strictEqual(turn2.turnIndex, 2, 'Turn index must be 2');
  console.log(`✓ Turn 2 inherited location: ${turn2.location.name} (Time: ${turn2.timeWindow.requestedText})`);

  // Turn 3: Follow-up question exploring scenario
  console.log('\n--- Turn 3: "Are there any lightning or storm alerts here?" ---');
  const turn3 = await runOrcaAgentWorkflow(
    'Are there any lightning or storm alerts here?',
    undefined,
    undefined,
    'en',
    sessionId
  );
  assert.strictEqual(turn3.location.name.toLowerCase().includes('visakhapatnam'), true, 'Turn 3 must retain Visakhapatnam');
  assert.strictEqual(turn3.turnIndex, 3, 'Turn index must be 3');
  console.log(`✓ Turn 3 alerts evaluated for: ${turn3.location.name} (Alerts count: ${turn3.alertSummary?.activeAlertCount ?? 0})`);

  // Turn 4: Explicit location switch
  console.log('\n--- Turn 4: "Now check conditions near Kochi" (Explicit switch) ---');
  const turn4 = await runOrcaAgentWorkflow(
    'Now check conditions near Kochi',
    undefined,
    undefined,
    'en',
    sessionId
  );
  assert.strictEqual(turn4.location.name.toLowerCase().includes('kochi'), true, 'Turn 4 must switch to Kochi');
  assert.strictEqual(turn4.turnIndex, 4, 'Turn index must be 4');
  console.log(`✓ Turn 4 switched location to: ${turn4.location.name}`);

  // Turn 5: Request PFZ for Kochi
  console.log('\n--- Turn 5: "Where is the nearest fishing zone here?" ---');
  const turn5 = await runOrcaAgentWorkflow(
    'Where is the nearest fishing zone here?',
    undefined,
    undefined,
    'en',
    sessionId
  );
  assert.strictEqual(turn5.location.name.toLowerCase().includes('kochi'), true, 'Turn 5 must retain Kochi');
  assert.strictEqual(turn5.turnIndex, 5, 'Turn index must be 5');
  assert.ok(turn5.pfz, 'Turn 5 must generate PFZ analysis');
  console.log(`✓ Turn 5 PFZ best zone: ${turn5.pfz?.bestZone?.id} (Score: ${turn5.pfz?.bestZone?.score}/100)`);

  // Turn 6: Contextual safe route to that PFZ without naming location or coordinates
  console.log('\n--- Turn 6: "What is the safest route to navigate there?" ---');
  const turn6 = await runOrcaAgentWorkflow(
    'What is the safest route to navigate there?',
    undefined,
    undefined,
    'en',
    sessionId
  );
  assert.strictEqual(turn6.location.name.toLowerCase().includes('kochi'), true, 'Turn 6 must retain Kochi');
  assert.strictEqual(turn6.turnIndex, 6, 'Turn index must be 6');
  assert.ok(turn6.safeRoute, 'Turn 6 must compute safe route inheriting active PFZ target');
  console.log(`✓ Turn 6 Safe Route: ${turn6.safeRoute?.status} (Distance: ${turn6.safeRoute?.distanceKm} km, Waypoints: ${turn6.safeRoute?.waypointCount})`);

  // Verify stored session in memory and disk
  const stored = getSession(sessionId);
  assert.ok(stored, 'Session must exist in memory');
  assert.strictEqual(stored?.turns.length, 6, 'Session must contain 6 recorded turns');
  assert.ok(stored?.activePfz, 'Session must retain active PFZ');
  assert.ok(stored?.activeRoute, 'Session must retain active Route');
  assert.ok(stored?.activeGeofence, 'Session must retain active Geofence');
  assert.ok(stored?.activeDecision, 'Session must retain active Decision');

  // Verify disk persistence
  const fs = await import('node:fs');
  const path = await import('node:path');
  const diskPath = path.resolve(process.cwd(), 'data', 'sessions', `${sessionId}.json`);
  assert.ok(fs.existsSync(diskPath), `Session file must be persisted to disk at ${diskPath}`);
  console.log(`✓ Disk persistence verified: file exists at ${diskPath}`);

  console.log(`\n✓ Stored session verification passed: ${stored?.turns.length} turns recorded.`);
  console.log('✓ Title:', stored?.title);
  console.log('✓ Active PFZ Zone ID:', stored?.activePfzZoneId);
  console.log('✓ Active Route Status:', stored?.activeRoute?.status);
  console.log('✓ Active Decision:', stored?.activeDecision?.decision);
  console.log('\n=== ALL MULTI-TURN CONVERSATION TESTS PASSED ===');
}

testConversationSession().catch(err => {
  console.error('Conversation session test failed:', err);
  process.exit(1);
});
