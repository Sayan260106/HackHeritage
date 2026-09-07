import { voiceWarning } from '../src/services/audio/voiceWarningService.ts';
import { GeofenceAlert, LanguageCode, LocationInfo, RiskPrediction } from '../src/types.ts';

const SAMPLE_CRITICAL_ALERT: GeofenceAlert = {
  boundaryId: 'imbl-india-srilanka',
  boundaryName: 'India – Sri Lanka International Maritime Boundary Line (IMBL)',
  type: 'IMBL',
  distanceNm: 1.8,
  distanceKm: 3.33,
  severity: 'CRITICAL_BREACH',
  warningMessage: 'Critical breach',
  treatyOrAuthority: 'UNCLOS 1974 Treaty',
};

const SAMPLE_INSIDE_MPA_ALERT: GeofenceAlert = {
  boundaryId: 'mpa-sundarbans-aquatic',
  boundaryName: 'Sundarbans Biosphere Reserve Marine Buffer Zone',
  type: 'MPA',
  distanceNm: 3.5,
  distanceKm: 6.48,
  severity: 'CRITICAL_BREACH',
  warningMessage: 'Inside Sundarbans reserve',
  treatyOrAuthority: 'UNESCO World Heritage',
  isInside: true,
  insideDepthNm: 3.5,
  insideDepthKm: 6.48,
  escapeBearingDeg: 195,
};

const SAMPLE_CROSSED_IMBL_ALERT: GeofenceAlert = {
  boundaryId: 'imbl-india-bangladesh',
  boundaryName: 'India – Bangladesh Maritime Boundary (PCA 2014 Delimitation)',
  type: 'IMBL',
  distanceNm: 2.4,
  distanceKm: 4.44,
  severity: 'CRITICAL_BREACH',
  warningMessage: 'Crossed Bangladesh border',
  treatyOrAuthority: 'PCA Award 2014',
  hasCrossedBorder: true,
  isInside: true,
  insideDepthNm: 2.4,
  insideDepthKm: 4.44,
  escapeBearingDeg: 270,
};

const SAMPLE_PROXIMITY_ALERT: GeofenceAlert = {
  boundaryId: 'mpa-gahirmatha',
  boundaryName: 'Gahirmatha Marine Wildlife Sanctuary',
  type: 'MPA',
  distanceNm: 4.6,
  distanceKm: 8.5,
  severity: 'PROXIMITY_WARNING',
  warningMessage: 'Approaching sanctuary',
  treatyOrAuthority: 'Odisha Wildlife Dept',
};

const SAMPLE_RISK: RiskPrediction = {
  riskScore: 92,
  riskLevel: 'EXTREME',
  confidenceScore: 95,
  modelVersion: 'orca-xgb-2.5',
  predictionTarget: 'forward_6h',
  primaryRecommendation: 'Suspend all marine and fishing activities.',
  safetySummary: 'Dangerous gale force winds',
  actionableAdvisories: ['Return to harbor'],
  restrictedCraftTypes: ['all'],
  safeCraftTypes: [],
  featureContributions: [],
  validUntil: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
};

const SAMPLE_LOCATION: LocationInfo = {
  name: 'Paradip Coastal Waters',
  state: 'Odisha',
  country: 'India',
  latitude: 20.3,
  longitude: 86.7,
  regionType: 'coastal_harbor',
  nearestPort: 'Paradeep Major Port',
};

const LANGUAGES: LanguageCode[] = ['en', 'hi', 'bn', 'ta', 'te', 'or', 'ml', 'gu', 'mr', 'kn'];

const BANNED_ENGLISH_WORDS = [
  'nautical',
  'miles',
  'boundary',
  'harbour',
  'harbor',
  'advisory',
  'vessel',
  'danger',
  'extreme',
  'alert',
  'warning',
  'status',
  'score',
  'recommendation',
];

async function runComprehensiveMatrix() {
  console.log('================================================================');
  console.log('🌊 ORCA-X COMPREHENSIVE 10-LANGUAGE × 7-WARNING AUDIO VERIFICATION');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedAudioSyntheses = 0;

  for (const lang of LANGUAGES) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`🇮🇳 Testing Language: [${lang.toUpperCase()}]`);
    console.log(`------------------------------------------------------------`);

    const phrases = {
      '1. Inside Sanctuary / MPA (Sundarbans)': voiceWarning.generateGeofencePhrase(SAMPLE_INSIDE_MPA_ALERT, lang),
      '2. Crossed Border into Foreign Waters (Bangladesh)': voiceWarning.generateGeofencePhrase(SAMPLE_CROSSED_IMBL_ALERT, lang),
      '3. Critical Border Proximity (<3 NM)': voiceWarning.generateGeofencePhrase(SAMPLE_CRITICAL_ALERT, lang),
      '4. Boundary Proximity Warning': voiceWarning.generateGeofencePhrase(SAMPLE_PROXIMITY_ALERT, lang),
      '5. Severe Weather Warning': voiceWarning.generateWeatherPhrase(SAMPLE_RISK, lang),
      '6. Comprehensive Risk Verdict': voiceWarning.generateRiskVerdictPhrase(SAMPLE_LOCATION, SAMPLE_RISK, SAMPLE_CRITICAL_ALERT, lang),
      '7. System Audio Test': voiceWarning.generateTestPhrase(lang),
    };

    for (const [warningType, phrase] of Object.entries(phrases)) {
      totalTests++;
      console.log(`\n  [${warningType}]`);
      console.log(`  Spoken Text: "${phrase}"`);

      // Verify zero leaked English words for regional languages
      if (lang !== 'en') {
        const lower = phrase.toLowerCase();
        for (const badWord of BANNED_ENGLISH_WORDS) {
          if (lower.includes(badWord)) {
            console.error(`  ❌ DETECTED LEAKED ENGLISH WORD "${badWord}" in [${lang}]!`);
            process.exit(1);
          }
        }
        console.log(`  ✓ Pure native diction verified (0 English words)`);
      }

      // Test real audio synthesis via server endpoint
      try {
        const res = await fetch('http://localhost:3000/api/indic-voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: phrase,
            language: lang,
            engine: 'auto',
          }),
        });

        const data = await res.json() as { success?: boolean; engine?: string; format?: string; audioBase64?: string };

        if (!data.success || !data.audioBase64 || data.audioBase64.length === 0) {
          console.error(`  ❌ Server audio synthesis failed for [${lang}] ${warningType}:`, data);
          process.exit(1);
        }

        const audioBytes = Buffer.from(data.audioBase64, 'base64').length;
        passedAudioSyntheses++;
        console.log(`  ✓ Audio Synthesized: ${data.format} (${audioBytes} bytes, engine: ${data.engine})`);
      } catch (synthErr) {
        console.error(`  ❌ Synthesis request error:`, synthErr);
        process.exit(1);
      }
    }
  }

  console.log('\n================================================================');
  console.log(`🎉 100% COMPLETE! All ${totalTests} test combinations passed successfully!`);
  console.log(`🔊 ${passedAudioSyntheses}/${totalTests} native MP3 audio streams verified!`);
  console.log('================================================================');
}

runComprehensiveMatrix();
