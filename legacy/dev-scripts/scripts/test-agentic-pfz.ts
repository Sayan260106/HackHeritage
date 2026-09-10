import { createOrcaPlan, getRunnableTasks } from '../server/services/agenticPlanner.ts';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const fishingPlan = createOrcaPlan('Find the best potential fishing zone near Goa with chlorophyll and SST');
const fishingTasks = new Map(fishingPlan.tasks.map(task => [task.id, task]));

assert(fishingTasks.get('pfz')?.enabled === true, 'Fishing/PFZ query must enable PFZ task.');
assert(fishingTasks.get('pfz')?.dependsOn.includes('risk') === true, 'PFZ must depend on marine risk.');
assert(fishingTasks.get('pfz')?.dependsOn.includes('gis') === true, 'Fishing PFZ task must consume GIS/geofence reasoning when GIS is enabled.');
assert(fishingTasks.get('safe_route')?.enabled === false, 'PFZ discovery without an explicit route request should not run safe routing.');
assert(fishingTasks.get('synthesis')?.dependsOn.includes('pfz') === true, 'Synthesis must consume PFZ output.');
assert(fishingPlan.intent === 'potential_fishing_zone_intelligence', 'PFZ query should receive PFZ-specific intent.');

const routingPlan = createOrcaPlan('Find the best PFZ near Goa and route me safely to it');
const routingTasks = new Map(routingPlan.tasks.map(task => [task.id, task]));
assert(routingTasks.get('safe_route')?.enabled === true, 'Explicit PFZ routing query must enable safe routing.');
assert(routingTasks.get('safe_route')?.dependsOn.includes('pfz') === true, 'Safe routing must consume the selected PFZ.');
assert(routingTasks.get('safe_route')?.dependsOn.includes('gis') === true, 'Safe routing must consume GIS/geofence reasoning.');
assert(routingTasks.get('safe_route')?.dependsOn.includes('risk') === true, 'Safe routing must consume marine risk.');
assert(routingTasks.get('synthesis')?.dependsOn.includes('safe_route') === true, 'Synthesis must consume safe-route output.');
assert(routingPlan.intent === 'pfz_safe_routing', 'PFZ routing query should receive routing-specific intent.');

const initialRunnable = getRunnableTasks(routingPlan).map(task => task.id).sort();
assert(initialRunnable.length === 1 && initialRunnable[0] === 'resolve_location_time', 'Only location/time resolution should be runnable initially.');

const safetyPlan = createOrcaPlan('Is it safe to venture tomorrow morning?', 'en');
const safetyPfz = safetyPlan.tasks.find(task => task.id === 'pfz');
const safetyRoute = safetyPlan.tasks.find(task => task.id === 'safe_route');
assert(safetyPfz?.enabled === false, 'Pure safety query should not run PFZ unless requested.');
assert(safetyRoute?.enabled === false, 'Pure safety query should not run safe routing unless requested.');

console.log('ORCA-X agentic PFZ/safe-routing planning tests passed:', {
  fishingPfzEnabled: fishingTasks.get('pfz')?.enabled,
  fishingSafeRouteEnabled: fishingTasks.get('safe_route')?.enabled,
  routingSafeRouteEnabled: routingTasks.get('safe_route')?.enabled,
  safeRouteDependencies: routingTasks.get('safe_route')?.dependsOn,
  synthesisIncludesSafeRoute: routingTasks.get('synthesis')?.dependsOn.includes('safe_route'),
  initialRunnable,
  safetyPfzEnabled: safetyPfz?.enabled,
  safetyRouteEnabled: safetyRoute?.enabled,
});
