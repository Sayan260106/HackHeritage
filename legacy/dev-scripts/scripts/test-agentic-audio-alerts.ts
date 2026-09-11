import assert from 'node:assert';
import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';

async function testAgenticAudioAlerts() {
  console.log('======================================================================');
  console.log('🔊 ORCA-X AGENTIC AUDIO & VOICE WARNING ALERT INTEGRATION TEST');
  console.log('======================================================================\n');

  // Test 1: Standard Operational Advisory in English
  console.log('[Test 1] Standard marine query (English):');
  const resEn = await runOrcaAgentWorkflow(
    'Is it safe to venture into sea near Visakhapatnam right now?',
    undefined,
    undefined,
    'en'
  );

  assert.ok(resEn.audioAlert, 'Response must include audioAlert');
  assert.strictEqual(resEn.audioAlert.language, 'en');
  assert.ok(typeof resEn.audioAlert.phrase === 'string' && resEn.audioAlert.phrase.length > 10, 'Audio phrase must not be empty');
  assert.ok(
    ['SIREN_CRITICAL', 'CHIME_WARNING', 'VOICE_BRIEFING'].includes(resEn.audioAlert.cueType),
    `Valid cueType expected, got ${resEn.audioAlert.cueType}`
  );
  console.log(`  ✓ English Audio Cue:  [${resEn.audioAlert.cueType}] (Critical: ${resEn.audioAlert.isCritical})`);
  console.log(`  ✓ Spoken Phrase:      "${resEn.audioAlert.phrase}"\n`);

  // Test 2: Multilingual Spoken Alert (Hindi)
  console.log('[Test 2] Regional language voice alert (Hindi):');
  const resHi = await runOrcaAgentWorkflow(
    'क्या अभी विशाखापट्टनम में समुद्र में जाना सुरक्षित है?',
    undefined,
    undefined,
    'hi'
  );

  assert.ok(resHi.audioAlert, 'Hindi response must include audioAlert');
  assert.strictEqual(resHi.audioAlert.language, 'hi');
  assert.ok(typeof resHi.audioAlert.phrase === 'string' && resHi.audioAlert.phrase.length > 10);
  assert.ok(
    resHi.audioAlert.phrase.includes('विशाखापट्टनम') || resHi.audioAlert.phrase.includes('जोखिम') || resHi.audioAlert.phrase.includes('स्थिति'),
    `Expected Hindi diction in phrase, got: "${resHi.audioAlert.phrase}"`
  );
  console.log(`  ✓ Hindi Audio Cue:    [${resHi.audioAlert.cueType}] (Critical: ${resHi.audioAlert.isCritical})`);
  console.log(`  ✓ Spoken Hindi Phrase: "${resHi.audioAlert.phrase}"\n`);

  // Test 3: Multilingual Spoken Alert (Bengali)
  console.log('[Test 3] Regional language voice alert (Bengali):');
  const resBn = await runOrcaAgentWorkflow(
    'দিঘার কাছে এখন মাছ ধরতে যাওয়া কি নিরাপদ?',
    undefined,
    undefined,
    'bn'
  );

  assert.ok(resBn.audioAlert, 'Bengali response must include audioAlert');
  assert.strictEqual(resBn.audioAlert.language, 'bn');
  assert.ok(typeof resBn.audioAlert.phrase === 'string' && resBn.audioAlert.phrase.length > 10);
  assert.ok(
    resBn.audioAlert.phrase.includes('দিঘা') || resBn.audioAlert.phrase.includes('ঝুঁকির') || resBn.audioAlert.phrase.includes('পরিস্থিতি'),
    `Expected Bengali diction in phrase, got: "${resBn.audioAlert.phrase}"`
  );
  console.log(`  ✓ Bengali Audio Cue:  [${resBn.audioAlert.cueType}] (Critical: ${resBn.audioAlert.isCritical})`);
  console.log(`  ✓ Spoken Bengali Phrase: "${resBn.audioAlert.phrase}"\n`);

  console.log('======================================================================');
  console.log('✔ ALL AGENTIC AUDIO ALERT INTEGRATION TESTS PASSED!');
  console.log('======================================================================');
}

testAgenticAudioAlerts().catch(err => {
  console.error('Audio alert integration test failed:', err);
  process.exit(1);
});
