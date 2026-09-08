const { spawnSync } = await import('node:child_process');

const suites = [
  ['Agent executor', 'npm', ['run', 'test:agentic']],
  ['Agentic PFZ', 'npm', ['run', 'test:agentic-pfz']],
  ['Agentic safe routing', 'npm', ['run', 'test:agentic-safe-routing']],
  ['Decision fusion', 'npm', ['run', 'test:decision-fusion']],
  ['Safe routing', 'npm', ['run', 'test:safe-routing']],
  ['Alert engine', 'npm', ['run', 'test:alerts']],
  ['Agentic alerts', 'npm', ['run', 'test:agentic-alerts']],
  ['Geofencing', 'npm', ['run', 'test:geofence']],
  ['GIS intelligence', 'npm', ['run', 'test:gis']],
  ['Agentic GIS', 'npm', ['run', 'test:gis-agentic']],
  ['PFZ intelligence', 'npm', ['run', 'test:pfz']],
  ['MOSDAC cache', 'npm', ['run', 'test:mosdac-cache']],
  ['Maritime audio', 'npm', ['run', 'test:maritime-audio']],
  ['All-language warning contracts', 'npm', ['run', 'test:all-languages']],
  ['Hybrid retrieval contracts', 'npm', ['run', 'test:hybrid-types']],
  ['Conversation session', 'npm', ['run', 'test:conversation']],
  ['Marine forecast', 'npm', ['run', 'test:forecast']],
  ['RAG evidence', 'npm', ['run', 'test:rag']],
  ['ISRO benchmark queries', 'npm', ['run', 'test:isro-benchmarks']],
  ['Multilingual end-to-end', 'npm', ['run', 'test:multilingual-e2e']],
];

const startedAt = Date.now();
const failures = [];

console.log('======================================================================');
console.log('ORCA-X FULL VALIDATION RUNNER');
console.log('This command is a release gate; a suite failure stops the run.');
console.log('======================================================================\n');

for (const [label, command, args] of suites) {
  console.log(`--- ${label} ---`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    failures.push(label);
    console.error(`\n❌ ${label} failed.`);
    break;
  }
  console.log(`✅ ${label} passed.\n`);
}

const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('======================================================================');
if (failures.length > 0) {
  console.error(`FULL VALIDATION FAILED after ${elapsedSeconds}s: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`FULL VALIDATION PASSED in ${elapsedSeconds}s.`);
console.log('======================================================================');
