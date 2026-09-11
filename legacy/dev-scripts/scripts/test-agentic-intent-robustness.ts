import assert from 'node:assert/strict';
import { createOrcaPlan } from '../server/services/agenticPlanner.ts';

console.log('=== Testing Agentic Intent Classification & Robustness ===');

// 1. Standard Intent Disambiguation
const p1 = createOrcaPlan('Is it safe for small fishing boats near Digha right now?');
assert.equal(p1.tasks.find(t => t.id === 'weather')?.enabled, true);
assert.equal(p1.tasks.find(t => t.id === 'ocean')?.enabled, true);
assert.equal(p1.tasks.find(t => t.id === 'risk')?.enabled, true);
assert.equal(p1.tasks.find(t => t.id === 'safe_route')?.enabled, false, 'Should not plan safe route without explicit route request');
console.log('✔ Test 1: Standard fishing safety query correctly disables unrequested safe routing');

// 2. Explicit Routing Query
const p2 = createOrcaPlan('Find the best PFZ near Goa and route me safely to it');
assert.equal(p2.intent, 'pfz_safe_routing');
assert.equal(p2.tasks.find(t => t.id === 'safe_route')?.enabled, true);
assert.equal(p2.tasks.find(t => t.id === 'pfz')?.enabled, true);
console.log('✔ Test 2: Routing query enables safe_route and pfz tasks');

// 3. Negation Filtering (e.g. Do not compute route)
const p3 = createOrcaPlan('Find fish zones near Paradip but do NOT route me or navigate');
assert.equal(p3.tasks.find(t => t.id === 'safe_route')?.enabled, false, 'Negated routing must not enable safe_route');
assert.equal(p3.tasks.find(t => t.id === 'pfz')?.enabled, true);
console.log('✔ Test 3: Negated routing phrase correctly leaves safe_route disabled');

// 4. Multilingual Bengali Query
const p4 = createOrcaPlan('দীঘার কাছে সাগরে মাছ ধরার জন্য কি নিরাপদ?');
assert.equal(p4.tasks.find(t => t.id === 'weather')?.enabled, true);
assert.equal(p4.tasks.find(t => t.id === 'risk')?.enabled, true);
assert.equal(p4.tasks.find(t => t.id === 'pfz')?.enabled, true);
console.log('✔ Test 4: Bengali fishing safety query properly parsed');

// 5. Multilingual Hindi Query
const p5 = createOrcaPlan('क्या कल गोवा के पास मछली पकड़ने के लिए मौसम सुरक्षित है?');
assert.equal(p5.tasks.find(t => t.id === 'weather')?.enabled, true);
assert.equal(p5.tasks.find(t => t.id === 'risk')?.enabled, true);
console.log('✔ Test 5: Hindi query correctly enabled weather and risk tasks');

// 6. Typo & Colloquial Query
const p6 = createOrcaPlan('what is cyclone allert and storm warning at vizag port?');
assert.equal(p6.tasks.find(t => t.id === 'alerts')?.enabled, true);
assert.equal(p6.tasks.find(t => t.id === 'evidence')?.enabled, true);
console.log('✔ Test 6: Typo in alert query ("allert") matched via cyclone/storm keywords');

console.log('\n=== ALL AGENTIC INTENT ROBUSTNESS TESTS PASSED ===');
