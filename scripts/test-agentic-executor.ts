import assert from 'node:assert/strict';
import { createOrcaPlan, OrcaPlan } from '../server/services/agenticPlanner.ts';
import { executeOrcaPlan } from '../server/services/agenticExecutor.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function task(plan: OrcaPlan, id: OrcaPlan['tasks'][number]['id']) {
  const found = plan.tasks.find(candidate => candidate.id === id);
  assert.ok(found, `Expected task ${id} to exist`);
  return found;
}

async function testParallelReadyTasks() {
  const plan = createOrcaPlan('What is the weather in Goa tomorrow?');
  const starts: string[] = [];
  const completions: string[] = [];
  const riskStarts: number[] = [];
  let active = 0;
  let maxActive = 0;

  const handler = async (id: string) => {
    starts.push(id);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(40);
    active -= 1;
    completions.push(id);
  };

  const result = await executeOrcaPlan(plan, {
    resolve_location_time: async () => undefined,
    weather: () => handler('weather'),
    ocean: () => handler('ocean'),
    risk: async () => {
      riskStarts.push(completions.length);
    },
    synthesis: async () => undefined,
  });

  assert.equal(maxActive, 2, 'weather and ocean should execute in parallel');
  assert.deepEqual(starts.slice(0, 2).sort(), ['ocean', 'weather']);
  assert.equal(task(result.plan, 'weather').status, 'completed');
  assert.equal(task(result.plan, 'ocean').status, 'completed');
  assert.equal(task(result.plan, 'risk').status, 'completed');
  assert.equal(task(result.plan, 'synthesis').status, 'completed');
  assert.equal(riskStarts[0], 2, 'risk must start only after both weather and ocean complete');
}

async function testOptionalFailureReplans() {
  const plan = createOrcaPlan('What is the marine safety risk for fishing in Goa?');
  assert.equal(task(plan, 'satellite').enabled, true, 'fishing query should enable satellite');

  const result = await executeOrcaPlan(plan, {
    resolve_location_time: async () => undefined,
    weather: async () => undefined,
    ocean: async () => undefined,
    satellite: async () => {
      throw new Error('satellite connector unavailable');
    },
    risk: async () => undefined,
    gis: async () => undefined,
    pfz: async () => undefined,
    // Fishing queries now also enable the optional AlertAgent branch. Keep
    // this executor regression test focused on the intended satellite
    // failure by providing a successful alert handler.
    alerts: async () => undefined,
    evidence: async () => undefined,
    synthesis: async () => undefined,
  });

  assert.equal(result.replans, 1);
  assert.deepEqual(result.failures, [{ taskId: 'satellite', reason: 'satellite connector unavailable' }]);
  assert.equal(task(result.plan, 'satellite').status, 'failed');
  assert.equal(task(result.plan, 'satellite').enabled, false);
  assert.equal(task(result.plan, 'risk').status, 'completed');
  assert.equal(task(result.plan, 'gis').status, 'completed');
  assert.equal(task(result.plan, 'pfz').status, 'completed');
  assert.equal(task(result.plan, 'alerts').status, 'completed');
  assert.equal(task(result.plan, 'evidence').status, 'completed');
  assert.equal(task(result.plan, 'synthesis').status, 'completed');
  assert.equal(task(result.plan, 'risk').dependsOn.includes('satellite'), false);
  assert.equal(task(result.plan, 'synthesis').dependsOn.includes('satellite'), false);
}

async function testRequiredFailureBlocksDependents() {
  const plan = createOrcaPlan('What is the weather in Goa tomorrow?');

  const result = await executeOrcaPlan(plan, {
    resolve_location_time: async () => undefined,
    weather: async () => {
      throw new Error('weather provider unavailable');
    },
    ocean: async () => undefined,
    risk: async () => undefined,
    synthesis: async () => undefined,
  });

  assert.equal(result.replans, 0, 'required failures must not trigger optional replanning');
  assert.equal(task(result.plan, 'weather').status, 'failed');
  assert.equal(task(result.plan, 'risk').status, 'skipped');
  assert.equal(task(result.plan, 'synthesis').status, 'skipped');
  assert.equal(task(result.plan, 'risk').enabled, false);
  assert.equal(task(result.plan, 'synthesis').enabled, false);
  assert.equal(result.failures[0]?.taskId, 'weather');
}

async function main() {
  await testParallelReadyTasks();
  await testOptionalFailureReplans();
  await testRequiredFailureBlocksDependents();
  console.log('ORCA-X agentic executor tests passed.');
}

main().catch(error => {
  console.error('ORCA-X agentic executor tests failed:', error);
  process.exitCode = 1;
});
