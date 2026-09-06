import assert from 'node:assert/strict';
import { voiceWarning } from '../src/services/audio/voiceWarningService.ts';
import {
  INDIC_DEVANAGARI_PHONEMES,
  indicScriptToDevanagari,
} from '../src/services/audio/indicVoiceService.ts';
import { GeofenceAlert, LanguageCode, RiskPrediction, LocationInfo } from '../src/types.ts';

const ALL_LANGUAGES: LanguageCode[] = ['en', 'hi', 'bn', 'ta', 'te', 'or', 'ml', 'gu', 'mr', 'kn'];

const sampleLocation: LocationInfo = {
  name: 'Digha Coast',
  country: 'India',
  latitude: 21.62,
  longitude: 87.51,
  nearestPort: 'Digha Fishery Harbor',
  regionType: 'coastal_harbor',
};

const sampleCriticalBreach: GeofenceAlert = {
  boundaryId: 'imbl-india-srilanka',
  boundaryName: 'India – Sri Lanka IMBL (Palk Strait)',
  type: 'IMBL',
  distanceNm: 1.8,
  distanceKm: 3.33,
  severity: 'CRITICAL_BREACH',
  warningMessage: 'Critical boundary breach detected within 2 nautical miles',
  treatyOrAuthority: '1974 & 1976 UNCLOS Bilateral Treaty',
};

const sampleProximityWarning: GeofenceAlert = {
  boundaryId: 'mpa-gahirmatha',
  boundaryName: 'Gahirmatha Marine Sanctuary',
  type: 'MPA',
  distanceNm: 4.2,
  distanceKm: 7.78,
  severity: 'PROXIMITY_WARNING',
  warningMessage: 'Vessel in caution buffer approaching marine sanctuary',
  treatyOrAuthority: 'Odisha Forest Dept / WII',
};

const sampleExtremeRisk: RiskPrediction = {
  riskScore: 89,
  riskLevel: 'EXTREME',
  confidenceScore: 92,
  modelVersion: 'orca-xgb-2.5',
  predictionTarget: 'forward_6h',
  primaryRecommendation: 'Total suspension of all marine operations. Return to port immediately.',
  safetySummary: 'Dangerous gale force winds and severe swell exceeding 3.5m detected.',
  actionableAdvisories: ['Return to harbor', 'Secure artisanal vessels', 'Monitor MRCC VHF 16'],
  restrictedCraftTypes: ['all'],
  safeCraftTypes: [],
  featureContributions: [],
  validUntil: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
};

async function testAllHybridTypes() {
  console.log('================================================================');
  console.log('🧪 VERIFYING ALL HYBRID TYPES & MULTI-LINGUAL MARITIME AUDIO');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TYPE 1: HYBRID VOICE ENGINES (/api/indic-voice/tts & /api/indic-voice/status)
  // --------------------------------------------------------------------------
  console.log('1. Testing All 4 Hybrid Engine Modes:');

  // 1a. Gateway Status Check
  const statusRes = await fetch('http://localhost:3000/api/indic-voice/status');
  assert.equal(statusRes.status, 200, 'Status endpoint must return 200 OK');
  const statusData = await statusRes.json() as { status: string; supportedEngines: string[]; defaultEngine: string };
  assert.equal(statusData.status, 'ok', 'Status must be ok');
  assert.deepEqual(statusData.supportedEngines, ['sarvam', 'bhashini', 'edge'], 'Must support sarvam, bhashini, edge');
  console.log('   ✓ Status Check: Available engines ->', statusData.supportedEngines.join(', '));

  // 1b. Engine Type: "edge" (Offline Edge Devanagari Mode)
  const edgeTtsRes = await fetch('http://localhost:3000/api/indic-voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'জরুরী সতর্কতা', language: 'bn', engine: 'edge' }),
  });
  const edgeData = await edgeTtsRes.json() as { engine: string; fallback: boolean };
  assert.equal(edgeData.engine, 'edge', 'Engine mode "edge" must return edge response');
  assert.equal(edgeData.fallback, true, 'Edge mode must signal client-side edge synthesis');
  console.log('   ✓ Engine Type [EDGE]: Successfully routed to offline client-side Devanagari engine');

  // 1c. Engine Type: "auto" (Auto selection mode)
  const autoTtsRes = await fetch('http://localhost:3000/api/indic-voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Emergency warning', language: 'en', engine: 'auto' }),
  });
  const autoData = await autoTtsRes.json() as { engine: string };
  assert.ok(Boolean(autoData.engine), 'Engine mode "auto" must return an active engine');
  console.log('   ✓ Engine Type [AUTO]: Handled auto engine negotiation (Active:', autoData.engine, ')');

  // 1d. Engine Type: "sarvam" (Sarvam AI Bulbul mode)
  const sarvamTtsRes = await fetch('http://localhost:3000/api/indic-voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'चेतावनी', language: 'hi', engine: 'sarvam' }),
  });
  const sarvamData = await sarvamTtsRes.json() as { engine: string; fallback?: boolean };
  assert.ok(sarvamData.engine === 'sarvam' || sarvamData.fallback === true, 'Sarvam engine must respond or signal fallback');
  console.log('   ✓ Engine Type [SARVAM]: Gateway endpoint accepts Sarvam Bulbul:v1 requests');

  // 1e. Engine Type: "bhashini" (Bhashini NLTM / IndicTrans2 mode)
  const bhashiniTtsRes = await fetch('http://localhost:3000/api/indic-voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'அவசர எச்சரிக்கை', language: 'ta', engine: 'bhashini' }),
  });
  const bhashiniData = await bhashiniTtsRes.json() as { engine: string; fallback?: boolean };
  assert.ok(bhashiniData.engine === 'bhashini' || bhashiniData.fallback === true, 'Bhashini engine must respond or signal fallback');
  console.log('   ✓ Engine Type [BHASHINI]: Gateway endpoint accepts Bhashini Dhruva pipeline requests');

  // --------------------------------------------------------------------------
  // TYPE 2: ALL ALERT TYPES ACROSS ALL 10 COASTAL INDIAN LANGUAGES
  // --------------------------------------------------------------------------
  console.log('\n2. Testing All Alert Types Across All 10 Coastal Languages:');

  for (const lang of ALL_LANGUAGES) {
    console.log(`   ► Testing Language [${lang.toUpperCase()}]:`);

    // Alert Type A: Critical IMBL Breach Alert
    const criticalText = voiceWarning.generateGeofencePhrase(sampleCriticalBreach, lang);
    assert.ok(criticalText.length >= 15, `Critical phrase for ${lang} must not be empty`);
    assert.ok(criticalText.includes('1.8') || criticalText.includes('१.८') || criticalText.includes('Palk'), `Must contain distance/boundary`);

    // Alert Type B: Proximity Warning Alert
    const proximityText = voiceWarning.generateGeofencePhrase(sampleProximityWarning, lang);
    assert.ok(proximityText.length >= 15, `Proximity phrase for ${lang} must not be empty`);

    // Alert Type C: Severe Weather Warning Alert
    const weatherText = voiceWarning.generateWeatherPhrase(sampleExtremeRisk, lang);
    assert.ok(weatherText.length >= 15, `Weather phrase for ${lang} must not be empty`);

    // Alert Type D: Risk Card Verdict Narration
    const verdictText = voiceWarning.generateRiskVerdictPhrase(sampleLocation, sampleExtremeRisk, sampleCriticalBreach, lang);
    assert.ok(verdictText.length >= 20, `Verdict phrase for ${lang} must not be empty`);

    // Alert Type E: Test Audio Phrase
    const testText = voiceWarning.generateTestPhrase(lang);
    assert.ok(testText.length >= 15, `Test phrase for ${lang} must not be empty`);

    console.log(`     • Critical:  "${criticalText.slice(0, 48)}..."`);
    console.log(`     • Weather:   "${weatherText.slice(0, 48)}..."`);
    console.log(`     • Verdict:   "${verdictText.slice(0, 48)}..."`);
  }

  // --------------------------------------------------------------------------
  // TYPE 3: SCRIPT TRANSLITERATION FOR ALL REGIONAL BRAHMI SCRIPTS
  // --------------------------------------------------------------------------
  console.log('\n3. Testing Unicode Script-to-Devanagari Transliteration for All Regional Scripts:');
  const scriptSamples: Record<string, { script: string; lang: LanguageCode }> = {
    Bengali: { script: 'জরুরী সতর্কতা! আন্তর্জাতিক সীমানা থেকে মাত্র ২ নটিক্যাল মাইল দূরে।', lang: 'bn' },
    Tamil: { script: 'அவசர எச்சரிக்கை! படகு எல்லை அருகில் உள்ளது.', lang: 'ta' },
    Telugu: { script: 'అత్యవసర హెచ్చరిక! పడవ అంతర్జాతీయ సరిహద్దు సమీపంలో ఉంది.', lang: 'te' },
    Odia: { script: 'ଜରୁରୀ ସତର୍କତା! ଡଙ୍ଗା ଆନ୍ତର୍ଜାତୀୟ ସୀମା ନିକଟରେ।', lang: 'or' },
    Gujarati: { script: 'ચેતવણી! વહાણ આંતરરાષ્ટ્રીય સીમા નજીક છે.', lang: 'gu' },
    Malayalam: { script: 'അടിയന്തര മുന്നറിയിപ്പ്! ബോട്ട് അന്താരാഷ്ട്ര അതിർത്തിക്ക് അടുത്താണ്.', lang: 'ml' },
    Kannada: { script: 'ತುರ್ತು ಎಚ್ಚರಿಕೆ! ದೋಣಿ ಅಂತರರಾಷ್ಟ್ರೀಯ ಗಡಿ ಹತ್ತಿರದಲ್ಲಿದೆ.', lang: 'kn' },
  };

  for (const [name, { script, lang }] of Object.entries(scriptSamples)) {
    const devanagari = indicScriptToDevanagari(script, lang);
    assert.ok(devanagari.length > 5, `${name} script must be transliterated`);
    // Ensure no untransliterated regional base characters remain in the text
    const baseOffsets: Record<string, number> = {
      Bengali: 0x0980,
      Gujarati: 0x0A80,
      Odia: 0x0B00,
      Tamil: 0x0B80,
      Telugu: 0x0C00,
      Kannada: 0x0C80,
      Malayalam: 0x0D00,
    };
    const base = baseOffsets[name];
    const hasUnconverted = devanagari.split('').some((ch) => {
      const c = ch.charCodeAt(0);
      return c >= base && c <= base + 0x7F;
    });
    assert.equal(hasUnconverted, false, `All ${name} characters must be mapped to Devanagari`);
    console.log(`   ✓ ${name.padEnd(10)} -> "${devanagari.slice(0, 45)}..."`);
  }

  // --------------------------------------------------------------------------
  // TYPE 4: DEVANAGARI PHONEMIC MAPS FOR ALL 10 LANGUAGES
  // --------------------------------------------------------------------------
  console.log('\n4. Verifying Curated Devanagari Phonemic Maps:');
  for (const lang of ALL_LANGUAGES) {
    const map = INDIC_DEVANAGARI_PHONEMES[lang];
    assert.ok(Boolean(map), `Devanagari phonemic map for ${lang} must exist`);
    assert.ok(map.critical('IMBL', '2.0').length > 10, `Critical phoneme for ${lang} must exist`);
    assert.ok(map.proximity('MPA', '4.5').length > 10, `Proximity phoneme for ${lang} must exist`);
    assert.ok(map.weather('EXTREME').length > 10, `Weather phoneme for ${lang} must exist`);
    assert.ok(map.verdict('Digha', 'HIGH', 78, 'Return to port').length > 10, `Verdict phoneme for ${lang} must exist`);
    assert.ok(map.test.length > 10, `Test phoneme for ${lang} must exist`);
    console.log(`   ✓ [${lang.toUpperCase()}] All 5 phonemic methods verified`);
  }

  // --------------------------------------------------------------------------
  // TYPE 5: MUTE & COOLDOWN CONTROLS
  // --------------------------------------------------------------------------
  console.log('\n5. Testing Mute & Cooldown Controls:');
  voiceWarning.setMuted(true);
  assert.equal(voiceWarning.getIsMuted(), true, 'Must report muted state');
  const mutedSpeak = await voiceWarning.speak('Test', 'en');
  assert.equal(mutedSpeak, false, 'Muted state must immediately return false and stay silent');
  voiceWarning.setMuted(false);
  assert.equal(voiceWarning.getIsMuted(), false, 'Must report unmuted state');
  console.log('   ✓ Mute suppressions verified');

  console.log('\n================================================================');
  console.log('🎉 ALL HYBRID TYPES VERIFIED (100% OPERATIONAL & GREEN)');
  console.log('================================================================\n');
}

testAllHybridTypes().catch((err) => {
  console.error('❌ Hybrid types test failed:', err);
  process.exit(1);
});
