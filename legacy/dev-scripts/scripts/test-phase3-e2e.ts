/**
 * ORCA-X Phase 3 Comprehensive End-to-End System Test Suite
 * Validates the complete pipeline:
 * 1. Multi-Turn Conversational Memory & Cold-Start Disk Persistence
 * 2. Agentic Vessel Surveillance & Sentinel-1 SAR Radar Ingestion
 * 3. Localized Indic Audio Alert Payload Generation (EN, HI, BN)
 * 4. Decoupled Safe Navigation Routing & Harbor Return
 * 5. What-If Studio Perturbation & Risk Calibration
 */

import fs from 'node:fs';
import path from 'node:path';
import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';
import { getOrCreateSession, getSession, deleteSession } from '../server/services/conversationService.ts';
import { calculateMarineRisk } from '../src/utils/marineRiskEngine.ts';
import { COASTAL_LOCATIONS } from '../src/data/coastalData.ts';
import { WeatherData, OceanData, SatelliteData, LanguageCode } from '../src/types.ts';

const executeOrcaPlan = (params: {
  query: string;
  locationOverride?: string;
  timeOverride?: string;
  language?: LanguageCode;
  sessionId?: string;
}) => runOrcaAgentWorkflow(params.query, params.locationOverride, params.timeOverride, params.language, params.sessionId);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function runPhase3E2ETests(): Promise<void> {
  console.log('======================================================================');
  console.log('🌊 ORCA-X PHASE 3: COMPREHENSIVE END-TO-END SYSTEM SUITE');
  console.log('======================================================================\n');

  const testSessionId = `session-phase3-e2e-${Date.now()}`;
  const digha = COASTAL_LOCATIONS.digha;

  // -------------------------------------------------------------------------
  // Test 1: Multi-Turn Memory & Disk Persistence Lifecycle
  // -------------------------------------------------------------------------
  console.log('[Test 1] Multi-Turn Memory & Cold-Start File Persistence:');
  const session = getOrCreateSession(testSessionId, digha);
  assert(session.sessionId === testSessionId, 'Session ID mismatch');
  assert(session.activeLocation?.name === digha.name, 'Active location not set');

  const planResponse1 = await executeOrcaPlan({
    query: 'Is it safe for small fishing crafts near Digha right now?',
    sessionId: testSessionId,
    locationOverride: 'digha',
    language: 'en',
  });

  assert(planResponse1.location.name.toLowerCase().includes('digha'), 'Plan did not resolve to Digha');
  assert(planResponse1.risk !== undefined, 'Risk prediction missing');
  assert(planResponse1.audioAlert !== undefined, 'Audio alert payload missing');

  const sessionFile = path.resolve(process.cwd(), `data/sessions/${testSessionId}.json`);
  assert(fs.existsSync(sessionFile), `Session file not created at ${sessionFile}`);

  // Test cold-start reload
  const reloaded = getSession(testSessionId);
  assert(reloaded !== undefined, 'Failed to reload session from disk');
  assert(reloaded!.turns.length === 1, 'Turn count mismatch after reload');
  console.log('  ✓ Turn 1 executed, recorded, and persisted to disk file.');

  // Second conversational turn: Implicit location inheritance
  const planResponse2 = await executeOrcaPlan({
    query: 'What about tomorrow morning?',
    sessionId: testSessionId,
    language: 'en',
  });
  assert(planResponse2.location.name.toLowerCase().includes('digha'), 'Did not inherit active location in Turn 2');
  console.log('  ✓ Turn 2 executed with implicit location inheritance.\n');

  // -------------------------------------------------------------------------
  // Test 2: Vessel Surveillance DAG & Sentinel-1 SAR Integration
  // -------------------------------------------------------------------------
  console.log('[Test 2] Vessel Surveillance & Sentinel-1 SAR Radar Ingestion:');
  const vesselPlan = await executeOrcaPlan({
    query: 'Are there any suspicious dark vessels or ship traffic near Visakhapatnam?',
    locationOverride: 'visakhapatnam',
    language: 'en',
  });

  assert(vesselPlan.vesselTraffic !== undefined, 'vesselTraffic is missing in OrcaAnalysisResponse');
  assert(vesselPlan.vesselTraffic!.totalTrackedVessels > 0, 'No targets detected');
  assert(vesselPlan.vesselTraffic!.targetVessels.length > 0, 'Target vessels list is empty');
  const sampleTarget = vesselPlan.vesselTraffic!.targetVessels[0];
  assert(Boolean(sampleTarget.mmsi || sampleTarget.name), 'Vessel target lacks identifier');
  console.log(`  ✓ Targets Tracked: ${vesselPlan.vesselTraffic!.totalTrackedVessels}`);
  console.log(`  ✓ AIS Compliant:   ${vesselPlan.vesselTraffic!.activeAisVessels}`);
  console.log(`  ✓ Dark Vessels:    ${vesselPlan.vesselTraffic!.darkVesselCount}`);
  console.log(`  ✓ Data Source:     ${vesselPlan.vesselTraffic!.dataSource}\n`);

  // -------------------------------------------------------------------------
  // Test 3: Localized Regional Audio Warnings (English, Hindi, Bengali)
  // -------------------------------------------------------------------------
  console.log('[Test 3] Localized Indic Audio Alert Generation:');
  const hindiPlan = await executeOrcaPlan({
    query: 'क्या आज दीघा के पास नाव लेकर जाना सुरक्षित है?',
    locationOverride: 'digha',
    language: 'hi',
  });
  assert(hindiPlan.audioAlert !== undefined, 'Hindi audio alert missing');
  assert(Boolean(hindiPlan.audioAlert!.phrase), 'Hindi phrase is empty');
  assert(hindiPlan.audioAlert!.language === 'hi', 'Audio alert language not set to hi');

  const bengaliPlan = await executeOrcaPlan({
    query: 'আজ দিঘার কাছে সমুদ্রে যাওয়া কি নিরাপদ?',
    locationOverride: 'digha',
    language: 'bn',
  });
  assert(bengaliPlan.audioAlert !== undefined, 'Bengali audio alert missing');
  assert(Boolean(bengaliPlan.audioAlert!.phrase), 'Bengali phrase is empty');
  assert(bengaliPlan.audioAlert!.language === 'bn', 'Audio alert language not set to bn');

  console.log(`  ✓ English Alert Phrase: "${planResponse1.audioAlert?.phrase}"`);
  console.log(`  ✓ Hindi Alert Phrase:   "${hindiPlan.audioAlert?.phrase}"`);
  console.log(`  ✓ Bengali Alert Phrase: "${bengaliPlan.audioAlert?.phrase}"\n`);

  // -------------------------------------------------------------------------
  // Test 4: Decoupled Safe Routing & Harbor Return
  // -------------------------------------------------------------------------
  console.log('[Test 4] Decoupled Safe Routing & Harbor Return:');
  const routePlan = await executeOrcaPlan({
    query: 'What is the safest navigation route to return to the nearest harbor?',
    locationOverride: '21.50,87.60',
    language: 'en',
  });
  assert(routePlan.safeRoute !== undefined, 'safeRoute is missing');
  assert(routePlan.safeRoute.status === 'ROUTE_FOUND', `Expected ROUTE_FOUND, got ${routePlan.safeRoute.status}`);
  assert(Array.isArray(routePlan.safeRoute.waypoints) && routePlan.safeRoute.waypoints.length > 0, 'No waypoints generated');
  console.log(`  ✓ Route Status:    ${routePlan.safeRoute.status}`);
  console.log(`  ✓ Distance:        ${routePlan.safeRoute.distanceKm} km`);
  console.log(`  ✓ Waypoint Count:  ${routePlan.safeRoute.waypoints.length}\n`);

  // -------------------------------------------------------------------------
  // Test 5: What-If Studio Perturbation & Risk Calibration
  // -------------------------------------------------------------------------
  console.log('[Test 5] What-If Studio Perturbation & Risk Calibration:');
  const dummySat: SatelliteData = {
    sstCelsius: 28.5,
    chlorophyllMgM3: 2.1,
    anomalyIndex: 0.2,
    favorableFishingZone: true,
    lastPassUtc: new Date().toISOString(),
    source: 'Oceansat-3 / Sentinel-3',
  };

  // Extreme Monsoon Perturbation
  const extremeWeather: WeatherData = {
    windSpeedKts: 36,
    windGustKts: 55,
    windDirectionDeg: 180,
    airTemperatureC: 25,
    pressureHpa: 988,
    visibilityKm: 2.0,
    precipitationMm: 35.0,
    observedAt: new Date().toISOString(),
    source: 'Open-Meteo',
  };
  const extremeOcean: OceanData = {
    waveHeightMeters: 4.8,
    maxWaveHeightMeters: 7.2,
    wavePeriodSec: 10,
    waveDirectionDeg: 190,
    swellHeightMeters: 3.5,
    swellPeriodSec: 16,
    currentSpeedKts: 2.8,
    seaSurfaceTemperatureC: 26,
    seaStateIndex: 6,
    seaStateDescription: 'Very Rough',
    observedAt: new Date().toISOString(),
    source: 'Open-Meteo',
  };

  const extremeRisk = calculateMarineRisk(extremeWeather, extremeOcean, dummySat, digha);
  assert(extremeRisk.riskLevel === 'EXTREME', `Expected EXTREME risk, got ${extremeRisk.riskLevel}`);
  assert(extremeRisk.riskScore >= 75, `Expected score >= 75, got ${extremeRisk.riskScore}`);
  console.log(`  ✓ Extreme Monsoon Preset: Risk ${extremeRisk.riskScore}/100 (${extremeRisk.riskLevel})`);

  // Calm Winter Trawling Perturbation
  const calmWeather: WeatherData = {
    ...extremeWeather,
    windSpeedKts: 6,
    windGustKts: 9,
    pressureHpa: 1014,
    visibilityKm: 12.0,
    precipitationMm: 0.0,
  };
  const calmOcean: OceanData = {
    ...extremeOcean,
    waveHeightMeters: 0.6,
    maxWaveHeightMeters: 0.9,
    swellHeightMeters: 0.3,
    swellPeriodSec: 7,
    currentSpeedKts: 0.4,
    seaStateIndex: 2,
    seaStateDescription: 'Smooth',
  };

  const calmRisk = calculateMarineRisk(calmWeather, calmOcean, dummySat, digha);
  assert(calmRisk.riskLevel === 'LOW', `Expected LOW risk, got ${calmRisk.riskLevel}`);
  assert(calmRisk.riskScore <= 30, `Expected score <= 30, got ${calmRisk.riskScore}`);
  console.log(`  ✓ Calm Trawling Preset:  Risk ${calmRisk.riskScore}/100 (${calmRisk.riskLevel})\n`);

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  deleteSession(testSessionId);
  console.log('  ✓ Test session cleaned up from disk.');

  console.log('======================================================================');
  console.log('🎉 ALL PHASE 3 END-TO-END TESTS PASSED WITH ZERO REGRESSIONS!');
  console.log('======================================================================\n');
}

runPhase3E2ETests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
