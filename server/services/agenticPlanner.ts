import { LanguageCode } from '../../src/types.ts';

export type OrcaTaskId = 'resolve_location_time' | 'weather' | 'ocean' | 'satellite' | 'risk' | 'gis' | 'evidence' | 'synthesis';
export type OrcaTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export interface OrcaTask { id: OrcaTaskId; label: string; dependsOn: OrcaTaskId[]; required: boolean; enabled: boolean; status: OrcaTaskStatus; reason: string; }
export interface OrcaPlan { planId: string; intent: string; rationale: string; tasks: OrcaTask[]; generatedAt: string; }
export interface ReplanInput { plan: OrcaPlan; failedTask: OrcaTaskId; reason: string; }
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function createOrcaPlan(query: string, language: LanguageCode = 'en'): OrcaPlan {
  const q = query.toLowerCase();
  const isFishing = /(fish|fishing|pfz|catch|marine|boat|vessel)/.test(q);
  const asksSafety = /(safe|safety|risk|danger|venture|route|navigate|navigation)/.test(q);
  const asksSatellite = /(satellite|chlorophyll|sst|thermal front|remote sensing|sentinel|mosdac|earth observation)/.test(q);
  const asksGis = /(map|near|nearest|distance|boundary|border|imbl|restricted|geofence|sanctuary|protected|zone|route|port|harbour|harbor|avoid|corridor|coordinate|lat|lon|gps)/.test(q);
  const needsSpatialReasoning = asksGis || isFishing || asksSafety;
  const asksEvidence = /(why|advisory|warning|regulation|rule|official|source|evidence|explain)/.test(q) || isFishing || asksSafety;
  const tasks: OrcaTask[] = [
    { id: 'resolve_location_time', label: 'Resolve location and time', dependsOn: [], required: true, enabled: true, status: 'pending', reason: 'Every marine query needs a spatial and temporal frame.' },
    { id: 'weather', label: 'Acquire weather conditions', dependsOn: ['resolve_location_time'], required: true, enabled: true, status: 'pending', reason: 'Weather affects operational exposure and route safety.' },
    { id: 'ocean', label: 'Acquire ocean conditions', dependsOn: ['resolve_location_time'], required: true, enabled: true, status: 'pending', reason: 'Waves, swell, currents and sea state are core marine signals.' },
    { id: 'satellite', label: 'Acquire satellite / EO observations', dependsOn: ['resolve_location_time'], required: false, enabled: asksSatellite || isFishing, status: 'pending', reason: asksSatellite ? 'The query explicitly requests Earth-observation intelligence.' : 'Fishing queries may benefit from EO indicators.' },
    { id: 'risk', label: 'Evaluate marine risk', dependsOn: ['weather', 'ocean'], required: true, enabled: true, status: 'pending', reason: 'Risk is a mandatory ORCA-X decision-support signal.' },
    { id: 'gis', label: 'Perform spatial / GIS reasoning', dependsOn: ['resolve_location_time'], required: false, enabled: needsSpatialReasoning, status: 'pending', reason: needsSpatialReasoning ? 'Enabled because the query requires spatial safety, fishing, distance, zone, boundary, routing or map reasoning.' : 'Enabled for distance, zones, boundaries, routing and map-oriented questions.' },
    { id: 'evidence', label: 'Retrieve authoritative evidence', dependsOn: ['resolve_location_time'], required: false, enabled: asksEvidence, status: 'pending', reason: 'Official advisories and domain rules strengthen operational answers but retrieval may degrade independently.' },
    { id: 'synthesis', label: `Synthesize grounded response (${language})`, dependsOn: [], required: true, enabled: true, status: 'pending', reason: 'Final synthesis consumes all selected branches.' }
  ];
  const satellite = tasks.find(t => t.id === 'satellite');
  const risk = tasks.find(t => t.id === 'risk');
  if (satellite?.enabled && risk) risk.dependsOn.push('satellite');
  const gis = tasks.find(t => t.id === 'gis');
  if (gis?.enabled) gis.dependsOn = ['resolve_location_time', 'risk'];
  const evidence = tasks.find(t => t.id === 'evidence');
  if (evidence?.enabled) evidence.dependsOn = ['resolve_location_time', 'risk'];
  const synthesis = tasks.find(t => t.id === 'synthesis');
  if (synthesis) synthesis.dependsOn = tasks.filter(t => t.id !== 'synthesis' && t.enabled).map(t => t.id);
  const enabled = tasks.filter(t => t.enabled).map(t => t.label).join(' -> ');
  return { planId: id('plan'), intent: asksSatellite ? 'earth_observation_marine_intelligence' : asksSafety ? 'marine_safety_fishing_advisory' : 'marine_intelligence', rationale: `Dynamic route selected from query signals. Enabled branches: ${enabled}`, tasks, generatedAt: new Date().toISOString() };
}

export function replanAfterFailure({ plan, failedTask, reason }: ReplanInput): OrcaPlan {
  const tasks = plan.tasks.map(task => ({ ...task, dependsOn: [...task.dependsOn] }));
  const failed = tasks.find(t => t.id === failedTask);
  if (failed) { failed.status = 'failed'; failed.enabled = false; failed.reason = `${failed.reason} Connector failed: ${reason}`; }
  for (const task of tasks) {
    if (!task.enabled || task.id === failedTask || !task.dependsOn.includes(failedTask)) continue;
    if (failed?.required) { task.status = 'failed'; task.enabled = false; task.reason = `Blocked by required dependency ${failedTask}.`; }
    else { task.dependsOn = task.dependsOn.filter(dep => dep !== failedTask); task.reason = `${task.reason} Optional dependency ${failedTask} unavailable; continuing in degraded mode.`; }
  }
  return { ...plan, planId: id('replan'), rationale: `${plan.rationale} Replanned after ${failedTask} failure; ${reason}`, tasks, generatedAt: new Date().toISOString() };
}

export function getRunnableTasks(plan: OrcaPlan): OrcaTask[] {
  return plan.tasks.filter(task => task.enabled && task.status === 'pending' && task.dependsOn.every(dep => {
    const dependency = plan.tasks.find(t => t.id === dep);
    return dependency?.status === 'completed' || dependency?.enabled === false;
  }));
}
