const baseUrl = process.env.ORCA_BASE_URL || 'http://127.0.0.1:3000';

const query = 'What is the marine safety risk for fishing in Goa?';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function main() {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/orca/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
  } catch (error) {
    fail(`Could not reach ORCA-X server at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const body = await response.json();
  assert(response.ok, `ORCA-X API returned HTTP ${response.status}: ${JSON.stringify(body)}`);

  assert(body.executionPlan, 'Response is missing executionPlan.');
  assert(Array.isArray(body.executionPlan.tasks), 'executionPlan.tasks must be an array.');
  assert(Array.isArray(body.agentTraces), 'Response is missing agentTraces.');
  assert(body.location?.name, 'Workflow did not resolve a location.');
  assert(body.timeWindow, 'Workflow did not resolve a time window.');
  assert(body.weather?.dataQuality === 'LIVE', 'Weather branch did not return LIVE data.');
  assert(body.ocean?.dataQuality === 'LIVE', 'Ocean branch did not return LIVE data.');
  assert(body.risk?.riskLevel, 'Risk branch did not produce a risk level.');
  assert(typeof body.groundedSummary === 'string' && body.groundedSummary.length > 0, 'Workflow did not produce a grounded summary.');

  const tasks = new Map(body.executionPlan.tasks.map(task => [task.id, task]));
  const enabled = [...tasks.values()].filter(task => task.enabled);

  for (const id of ['resolve_location_time', 'weather', 'ocean', 'satellite', 'risk', 'evidence', 'synthesis']) {
    assert(tasks.has(id), `Execution plan is missing ${id}.`);
  }

  assert(tasks.get('resolve_location_time').status === 'completed', 'Location/time task did not complete.');
  assert(tasks.get('weather').status === 'completed', 'Weather task did not complete.');
  assert(tasks.get('ocean').status === 'completed', 'Ocean task did not complete.');
  assert(tasks.get('risk').status === 'completed', 'Risk task did not complete.');
  assert(tasks.get('synthesis').status === 'completed', 'Synthesis task did not complete.');
  assert(tasks.get('satellite').enabled === true, 'Fishing query did not dynamically enable the satellite branch.');
  assert(tasks.get('evidence').enabled === true, 'Safety/fishing query did not dynamically enable the evidence branch.');

  const riskDeps = tasks.get('risk').dependsOn;
  assert(riskDeps.includes('weather'), 'Risk task must depend on weather.');
  assert(riskDeps.includes('ocean'), 'Risk task must depend on ocean.');

  const synthesisDeps = tasks.get('synthesis').dependsOn;
  assert(synthesisDeps.includes('risk'), 'Synthesis task must depend on risk.');
  assert(synthesisDeps.includes('weather'), 'Synthesis task must depend on weather.');
  assert(synthesisDeps.includes('ocean'), 'Synthesis task must depend on ocean.');

  const tracesByTask = new Map(body.agentTraces.map(trace => [trace.taskId, trace]));
  assert(tracesByTask.get('weather')?.status === 'completed', 'Weather trace is missing or incomplete.');
  assert(tracesByTask.get('ocean')?.status === 'completed', 'Ocean trace is missing or incomplete.');
  assert(tracesByTask.get('risk')?.status === 'completed', 'Risk trace is missing or incomplete.');
  assert(tracesByTask.get('synthesis')?.status === 'completed', 'Synthesis trace is missing or incomplete.');

  const weatherCompleted = Date.parse(tracesByTask.get('weather').completedAt);
  const oceanCompleted = Date.parse(tracesByTask.get('ocean').completedAt);
  const riskStarted = Date.parse(tracesByTask.get('risk').startedAt);
  assert(Number.isFinite(weatherCompleted) && Number.isFinite(oceanCompleted) && Number.isFinite(riskStarted), 'Agent trace timestamps are invalid.');
  assert(riskStarted >= Math.max(weatherCompleted, oceanCompleted), 'Risk started before both weather and ocean completed.');

  console.log('ORCA-X agentic workflow integration test passed:', JSON.stringify({
    intent: body.executionPlan.intent,
    enabledTasks: enabled.map(task => task.id),
    completedTasks: [...tasks.values()].filter(task => task.status === 'completed').map(task => task.id),
    riskLevel: body.risk.riskLevel,
    satelliteStatus: body.satellite?.status,
    evidenceCount: Array.isArray(body.evidence) ? body.evidence.length : 0,
  }));
}

main().catch(error => {
  console.error('ORCA-X agentic workflow integration test failed:', error);
  process.exitCode = 1;
});
