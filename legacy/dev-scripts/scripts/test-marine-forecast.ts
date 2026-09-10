import { LocationInfo } from '../src/types.ts';
import { buildTomorrowMarineRiskForecast } from '../server/services/realtime/marineForecastService.ts';

async function runTest() {
  console.log('--- Testing Tomorrow Marine Forecast & ML Contract ---');

  const location: LocationInfo = {
    name: 'Digha Coast',
    state: 'West Bengal',
    country: 'India',
    latitude: 21.6266,
    longitude: 87.5074,
    regionType: 'coastal_harbor',
  };

  console.log(`[1] Requesting tomorrow's hourly forecast for ${location.name} (${location.latitude}, ${location.longitude})...`);
  const result = await buildTomorrowMarineRiskForecast(location);


  console.log(`[OK] Forecast Date: ${result.forecastDate} (${result.timezone})`);
  console.log(`[OK] Model Version: ${result.modelVersion}`);
  console.log(`[OK] Total Hourly Slots: ${result.hourly.length}`);
  console.log(`[OK] Summary Worst Risk: ${result.summary.worstRiskLevel} at ${result.summary.worstRiskAt} (Score: ${result.summary.worstRiskScore})`);
  console.log(`[OK] Summary Average Score: ${result.summary.averageRiskScore}`);
  console.log(`[OK] High/Extreme Hours: ${result.summary.highOrExtremeHours}`);
  console.log(`[OK] Recommendation: "${result.summary.recommendation}"`);

  if (!result.hourly.length) {
    throw new Error('Forecast returned zero hourly points.');
  }

  const samplePoint = result.hourly[0];
  console.log(`[OK] First Point (${samplePoint.forecastAt}): Risk = ${samplePoint.risk?.riskLevel}, Score = ${samplePoint.risk?.riskScore}`);

  for (const warning of result.warnings) {
    console.log(`  - Warning/Provenance: ${warning}`);
  }

  console.log('\n--- ALL FORECAST TESTS PASSED SUCCESSFULLY ---');
}

runTest().catch((err) => {
  console.error('[FAIL] Marine forecast test failed:', err);
  process.exit(1);
});
