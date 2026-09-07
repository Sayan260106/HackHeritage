import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';

const ISRO_QUERIES = [
  { id: 'Q1', title: 'Nearest PFZ', query: 'Where is the nearest Potential Fishing Zone today?' },
  { id: 'Q2', title: 'Safe to venture tomorrow morning', query: 'Is it safe to venture into the sea tomorrow morning?' },
  { id: 'Q3', title: 'Tide, weather, sea conditions', query: 'What are the tide, weather, and sea conditions near my fishing location?' },
  { id: 'Q4', title: 'Lightning or cyclone alerts', query: 'Are there any lightning or cyclone alerts in my area?' },
  { id: 'Q5', title: 'High chlorophyll & favourable SST', query: 'Which regions show high chlorophyll concentration and favourable sea surface temperature?' },
  { id: 'Q6', title: 'Safest route for fishing vessel', query: 'What is the safest route for a fishing vessel considering weather and sea-state conditions?' },
  { id: 'Q7', title: 'Decline in fish productivity', query: 'Why has fish productivity declined in a particular coastal region?' },
  { id: 'Q8', title: 'Fishing zones to avoid (geofencing)', query: 'Which fishing zones should be avoided due to hazardous marine conditions or geofencing restrictions?' }
];

async function runAllQueries() {
  console.log('=== VERIFYING ALL 8 ISRO BENCHMARK QUERIES (Problem Statement 26176) ===\n');

  for (const item of ISRO_QUERIES) {
    console.log(`--- [${item.id}] ${item.title} ---`);
    console.log(`Query: "${item.query}"`);
    try {
      const response = await runOrcaAgentWorkflow(item.query, 'digha', undefined, 'en');
      console.log(`✓ Intent: ${response.detectedIntent}`);
      console.log(`✓ Location: ${response.location.name} (${response.location.latitude}, ${response.location.longitude})`);
      console.log(`✓ Weather: ${response.weather.source} | Wind ${response.weather.windSpeedKts} kts`);
      console.log(`✓ Ocean: ${response.ocean.source} | Wave ${response.ocean.waveHeightMeters}m | Sea State: ${response.ocean.seaStateDescription}`);
      console.log(`✓ Decision: ${response.operationalDecision?.decision} (Confidence: ${response.operationalDecision?.confidence})`);
      console.log(`✓ Active Alerts: ${response.alertSummary?.activeAlertCount ?? 0}`);
      const bestPfz = (response.pfz as any)?.bestZone;
      console.log(`✓ PFZ Best Zone: ${bestPfz ? `${bestPfz.id} (${bestPfz.distanceNm} NM)` : 'N/A'}`);
      console.log(`✓ Safe Route: ${response.safeRoute ? `${response.safeRoute.status} (${response.safeRoute.distanceKm ?? 'N/A'} km)` : 'N/A'}`);
      console.log(`✓ Geofence Status: ${response.geofenceAnalysis?.status}`);
      console.log(`✓ Grounded Summary Excerpt: "${response.groundedSummary.slice(0, 100).replace(/\n/g, ' ')}..."`);
      console.log(`✓ Execution Tasks Completed: ${response.executionPlan?.tasks.filter(t => t.status === 'completed').map(t => t.id).join(', ')}`);
      console.log('');
    } catch (err) {
      console.error(`❌ Failed on ${item.id}:`, err);
    }
  }
}

runAllQueries().then(() => console.log('=== ALL 8 ISRO BENCHMARK QUERIES COMPLETED ==='));
