import { LanguageCode } from '../../src/types.ts';
import { detectQueryLanguage } from '../../src/utils/languageDetector.ts';

export type OrcaTaskId = 'resolve_location_time' | 'weather' | 'ocean' | 'satellite' | 'risk' | 'gis' | 'pfz' | 'safe_route' | 'alerts' | 'evidence' | 'vessels' | 'synthesis';
export type OrcaTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export interface OrcaTask { id: OrcaTaskId; label: string; dependsOn: OrcaTaskId[]; required: boolean; enabled: boolean; status: OrcaTaskStatus; reason: string; }
export interface OrcaPlan { planId: string; intent: string; rationale: string; tasks: OrcaTask[]; generatedAt: string; }
export interface ReplanInput { plan: OrcaPlan; failedTask: OrcaTaskId; reason: string; }
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function createOrcaPlan(query: string, language: LanguageCode = 'en'): OrcaPlan {
  const detected = detectQueryLanguage(query, language);
  const effectiveLanguage = language !== 'en' ? language : detected.language;

  // Negation matching: ignore intent if explicitly negated by user
  const hasNegation = (pattern: RegExp) => new RegExp(`(?:don'?t|do not|no|without|never|avoid|not need|না|নয়|নাহ|নহে|নাহি|নেহি|नहीं|मत|வேண்டா�  const rawFishing = /(fish|fishing|pfz|catch|trawler|gillnet|purse seine|hilsa|sardine|mackerel|fishery|fisheries|মাছ|মৎস্য|জাল|मछली|मत्स्य|पकड़|மீன்|చేప|മത്സ്യം|માછલી)/i.test(query);
  const rawCraft = /(boat|vessel|craft|dinghy|catamaran|canoe|নৌকা|ট্রলার|नाव|नौका|படகு|పడవ|വള്ളം|होडी|ಬೋಟ್)/i.test(query);
  const rawSafety = /(safe|safety|risk|danger|venture|route|navigate|navigation|নিরাপদ|ঝুঁকি|বিপদ|সুরক্ষিত|खतरा|जोखिम|सुरक्षा|பாதுகாப்பு|ஆபத்து|సురక్షితం|ప్రమాదం|സുരക്ഷിതം|સુરક્ષિત|सुरक्षित)/i.test(query);
  const rawRouting = /(route|routing|navigate|navigation|travel to|reach|go to|safest path|পথ|রুট|রাস্তা|दिशा|பாதை|దారి|വഴി|રસ્તો)/i.test(query);
  const rawSatellite = /(satellite|chlorophyll|sst|thermal front|remote sensing|sentinel|mosdac|earth observation|স্যাটেলাইট|উপগ্রহ|क्लोरोफिल|उपग्रह|செயற்கைக்கோள்)/i.test(query);
  const rawPfz = /(pfz|potential fishing|fishing zone|catch|chlorophyll|sst|thermal front|productivity|fishery|fisheries|মাছ ধরার এলাকা|মৎস্য ক্ষেত্র|मछली पकड़ने का क्षेत्र|மீன்பிடி மண்டலம்)/i.test(query) || (rawFishing && !rawRouting);
  const rawGis = /(map|near|nearest|distance|boundary|border|imbl|restricted|geofence|sanctuary|protected|zone|route|port|harbour|harbor|avoid|corridor|coordinate|lat|lon|gps|কাছে|দূরত্ব|সীমানা|নকশা|नक्शा|दूरी|सीमा|வரைபடம்|தூரம்|దూరం)/i.test(query);
  const rawAlerts = /(alert|alerts|warning|warnings|hazard|hazards|storm|thunderstorm|lightning|cyclone|rough sea|sea state|deteriorat|worsen|danger|emergency|সতর্কতা|ঝড়|বজ্রপাত|সাইক্লোন|তুফান|चेतावनी|तूफान|बिजली|चक्रवात|எச்சரிக்கை|புயல்|மின்னல்|హెచ్చరిక|తుఫాను)/i.test(query);
  const rawVessels = /(vessel|vessels|ship|ships|boat traffic|trawler traffic|marine traffic|ais|dark vessel|radar|transponder|surveillance|buoy|buoys|naval|coast guard patrol|fairway|shipping channel|জাহাজ|নৌকা চলাচল|जहाज|नाव यातायात|கப்பல்|படகுகள்|ஓడలు|കപ്പലുകൾ)/i.test(query);

  // Apply negation suppression
  const isFishing = rawFishing && !hasNegation(/(?:fish|fishing|pfz|catch)/i);
  const asksSafety = rawSafety;
  const asksRouting = rawRouting && !hasNegation(/(?:route|routing|navigate|path)/i);
  const asksSatellite = rawSatellite && !hasNegation(/(?:satellite|remote sensing)/i);
  const asksPfz = rawPfz && !hasNegation(/(?:pfz|fishing zone)/i);
  const asksGis = rawGis;
  const asksAlerts = rawAlerts;
  const asksVessels = rawVessels && !hasNegation(/(?:vessel|ship|traffic|ais|buoy)/i);
  const needsSpatialReasoning = asksGis || isFishing || asksSafety || rawCraft;
  const asksEvidence = /(why|advisory|warning|regulation|rule|official|source|evidence|explain|protocol|procedure|guideline|sop|mandate|sanctuary|ban|helpline|hotline|channel|vhf|frequency|act|mfra|authority|coast guard|icg|imd|incois|dg shipping|tsunami|squall|harbour|harbor|কেন|কারণ|क्यो|क्यों|காரணம்|ఎందుకు)/i.test(query) || isFishing || asksSafety || asksAlerts;
  const enableAlerts = asksAlerts || asksSafety || isFishing;�ുകൾ)/i.test(query);

  // Apply negation suppression
  const isFishing = rawFishing && !hasNegation(/(?:fish|fishing|pfz|catch)/i);
  const asksSafety = rawSafety;
  const asksRouting = rawRouting && !hasNegation(/(?:route|routing|navigate|path)/i);
  const asksSatellite = rawSatellite && !hasNegation(/(?:satellite|remote sensing)/i);
  const asksPfz = rawPfz && !hasNegation(/(?:pfz|fishing zone)/i);
  const asksGis = rawGis;
  const asksAlerts = rawAlerts;
  const asksVessels = rawVessels && !hasNegation(/(?:vessel|ship|traffic|ais|buoy)/i);
  const needsSpatialReasoning = asksGis || isFishing || asksSafety;
  const asksEvidence = /(why|advisory|warning|regulation|rule|official|source|evidence|explain|protocol|procedure|guideline|sop|mandate|sanctuary|ban|helpline|hotline|channel|vhf|frequency|act|mfra|authority|coast guard|icg|imd|incois|dg shipping|tsunami|squall|harbour|harbor|কেন|কারণ|क्यो|क्यों|காரணம்|ఎందుకు)/i.test(query) || isFishing || asksSafety || asksAlerts;
  const enableAlerts = asksAlerts || asksSafety || isFishing;
  const tasks: OrcaTask[] = [
    { id: 'resolve_location_time', label: 'Resolve location and time', dependsOn: [], required: true, enabled: true, status: 'pending', reason: 'Every marine query needs a spatial and temporal frame.' },
    { id: 'weather', label: 'Acquire weather conditions', dependsOn: ['resolve_location_time'], required: true, enabled: true, status: 'pending', reason: 'Weather affects operational exposure and route safety.' },
    { id: 'ocean', label: 'Acquire ocean conditions', dependsOn: ['resolve_location_time'], required: true, enabled: true, status: 'pending', reason: 'Waves, swell, currents and sea state are core marine signals.' },
    { id: 'satellite', label: 'Acquire satellite / EO observations', dependsOn: ['resolve_location_time'], required: false, enabled: asksSatellite || isFishing, status: 'pending', reason: asksSatellite ? 'The query explicitly requests Earth-observation intelligence.' : 'Fishing queries may benefit from EO indicators.' },
    { id: 'risk', label: 'Evaluate marine risk', dependsOn: ['weather', 'ocean'], required: true, enabled: true, status: 'pending', reason: 'Risk is a mandatory ORCA-X decision-support signal.' },
    { id: 'gis', label: 'Perform spatial / GIS reasoning', dependsOn: ['resolve_location_time'], required: false, enabled: needsSpatialReasoning, status: 'pending', reason: needsSpatialReasoning ? 'Enabled because the query requires spatial safety, fishing, distance, zone, boundary, routing or map reasoning.' : 'Enabled for distance, zones, boundaries, routing and map-oriented questions.' },
    { id: 'pfz', label: 'Rank potential fishing zones', dependsOn: ['resolve_location_time'], required: false, enabled: asksPfz, status: 'pending', reason: asksPfz ? 'Enabled because the query requests fishing, PFZ, chlorophyll, SST or productivity intelligence.' : 'Enabled for PFZ and marine productivity queries.' },
    { id: 'safe_route', label: 'Compute geofence-safe route', dependsOn: ['resolve_location_time'], required: false, enabled: asksRouting, status: 'pending', reason: asksRouting ? 'Enabled because the query requests safe navigation or route optimization.' : 'Enabled for routing queries.' },
    { id: 'alerts', label: 'Evaluate proactive marine alerts', dependsOn: ['weather', 'ocean', 'risk'], required: false, enabled: enableAlerts, status: 'pending', reason: enableAlerts ? 'Enabled because the query or operating context requires hazard, warning or safety-change evaluation.' : 'Enabled for explicit alerts, warnings and safety-sensitive marine queries.' },
    { id: 'evidence', label: 'Retrieve authoritative evidence', dependsOn: ['resolve_location_time'], required: false, enabled: asksEvidence, status: 'pending', reason: 'Official advisories and domain rules strengthen operational answers but retrieval may degrade independently.' },
    { id: 'vessels', label: 'Surveil AIS vessel traffic and radar anomalies', dependsOn: ['resolve_location_time'], required: false, enabled: asksVessels, status: 'pending', reason: asksVessels ? 'The query requests maritime vessel traffic, AIS tracking, buoy stations, or dark vessel surveillance.' : 'Enabled for maritime traffic and surveillance queries.' },
    { id: 'synthesis', label: `Synthesize grounded response (${effectiveLanguage})`, dependsOn: [], required: true, enabled: true, status: 'pending', reason: `Final synthesis generates explainable response in ${effectiveLanguage}.` }
  ];
  const satellite = tasks.find(t => t.id === 'satellite');
  const risk = tasks.find(t => t.id === 'risk');
  if (satellite?.enabled && risk) risk.dependsOn.push('satellite');
  const gis = tasks.find(t => t.id === 'gis');
  if (gis?.enabled) gis.dependsOn = ['resolve_location_time', 'risk'];
  const pfz = tasks.find(t => t.id === 'pfz');
  if (pfz?.enabled) pfz.dependsOn = ['resolve_location_time', 'risk', ...(gis?.enabled ? ['gis' as OrcaTaskId] : [])];
  const safeRoute = tasks.find(t => t.id === 'safe_route');
  if (safeRoute?.enabled) safeRoute.dependsOn = ['resolve_location_time', 'risk', ...(pfz?.enabled ? ['pfz' as OrcaTaskId] : []), ...(gis?.enabled ? ['gis' as OrcaTaskId] : [])];
  const alerts = tasks.find(t => t.id === 'alerts');
  if (alerts?.enabled) alerts.dependsOn = ['weather', 'ocean', 'risk', ...(gis?.enabled ? ['gis' as OrcaTaskId] : []), ...(pfz?.enabled ? ['pfz' as OrcaTaskId] : [])];
  const evidence = tasks.find(t => t.id === 'evidence');
  if (evidence?.enabled) evidence.dependsOn = ['resolve_location_time', 'risk'];
  const vessels = tasks.find(t => t.id === 'vessels');
  if (vessels?.enabled) vessels.dependsOn = ['resolve_location_time'];
  const synthesis = tasks.find(t => t.id === 'synthesis');
  if (synthesis) synthesis.dependsOn = tasks.filter(t => t.id !== 'synthesis' && t.enabled).map(t => t.id);
  const enabled = tasks.filter(t => t.enabled).map(t => t.label).join(' -> ');
  return { planId: id('plan'), intent: asksRouting ? 'pfz_safe_routing' : asksPfz ? 'potential_fishing_zone_intelligence' : asksAlerts ? 'marine_alert_intelligence' : asksSatellite ? 'earth_observation_marine_intelligence' : asksVessels ? 'maritime_vessel_surveillance' : asksSafety ? 'marine_safety_fishing_advisory' : 'marine_intelligence', rationale: `Dynamic route selected from query signals. Enabled branches: ${enabled}`, tasks, generatedAt: new Date().toISOString() };
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
