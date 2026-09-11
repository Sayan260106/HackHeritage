import { COASTAL_LOCATIONS, MARINE_EVIDENCE_CORPUS } from '../../src/data/coastalData.ts';
import { EvidenceItem, LocationInfo } from '../../src/types.ts';

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3);
}

const EAST_COAST_STATES = new Set(['West Bengal', 'Odisha', 'Andhra Pradesh', 'Tamil Nadu', 'Puducherry', 'Andaman and Nicobar Islands']);
const WEST_COAST_STATES = new Set(['Gujarat', 'Maharashtra', 'Goa', 'Karnataka', 'Kerala', 'Daman and Diu', 'Lakshadweep']);

function resolveCoastFromLocation(location: LocationInfo): 'east' | 'west' | 'all' {
  const state = location.state || '';
  if (EAST_COAST_STATES.has(state)) return 'east';
  if (WEST_COAST_STATES.has(state)) return 'west';
  if (location.longitude > 79.5) return 'east';
  if (location.longitude < 76.5) return 'west';
  return 'all';
}

function lexicalRelevance(query: string, item: EvidenceItem): number {
  const queryTokens = new Set(normalize(query));
  if (queryTokens.size === 0) return 0;

  const haystack = normalize(
    `${item.id} ${item.title} ${item.excerpt} ${item.complianceRule || ''} ${item.sourceAuthority} ${item.documentType} ${item.topicCategory || ''} ${item.jurisdiction || ''}`,
  );
  const itemTokens = new Set(haystack);
  let matches = 0;
  for (const token of queryTokens) if (itemTokens.has(token)) matches += 1;
  let overlap = matches / queryTokens.size;

  const qLower = query.toLowerCase();
  const docLower = `${item.id} ${item.title} ${item.excerpt} ${item.complianceRule || ''} ${item.topicCategory || ''}`.toLowerCase();

  // Keyword rules & statutory boosts
  if (qLower.includes('gahirmatha') && docLower.includes('gahirmatha')) overlap += 0.40;
  if (qLower.includes('port warning signal') && (docLower.includes('port warning signal') || item.id.includes('PORT-SIGNALS'))) overlap += 0.40;
  if (qLower.includes('thermal front') && (docLower.includes('thermal front') || item.id.includes('PFZ-PROD'))) overlap += 0.40;
  if (qLower.includes('aggregate') && (docLower.includes('aggregate') || docLower.includes('aggregations'))) overlap += 0.25;
  if (qLower.includes('trawl ban') && (docLower.includes('trawl ban') || item.id.includes('TRAWL-BAN'))) overlap += 0.40;
  if (qLower.includes('vhf') && (docLower.includes('vhf') || item.id.includes('SAR-SOP') || item.id.includes('VHF-CHANNELS'))) overlap += 0.40;
  if (qLower.includes('declined') && (docLower.includes('depletion') || docLower.includes('declined') || item.id.includes('MFB'))) overlap += 0.40;
  if ((qLower.includes('hilsa') || qLower.includes('wbmfra')) && (docLower.includes('hilsa') || item.id.includes('WBMFRA'))) overlap += 0.45;
  if ((qLower.includes('ted') || qLower.includes('turtle excluder')) && (docLower.includes('ted') || item.id.includes('OMFRA-TURTLE'))) overlap += 0.45;
  if ((qLower.includes('palk bay') || qLower.includes('3-day') || qLower.includes('tnmfr')) && (docLower.includes('palk bay') || item.id.includes('TNMFR'))) overlap += 0.45;
  if ((qLower.includes('apmfra') || qLower.includes('coringa')) && (docLower.includes('apmfra') || item.id.includes('APMFRA'))) overlap += 0.45;
  if ((qLower.includes('kmfra') || qLower.includes('minimum legal size') || qLower.includes('night trawling')) && (docLower.includes('kmfra') || item.id.includes('KMFRA'))) overlap += 0.45;
  if ((qLower.includes('light fishing') || qLower.includes('led') || qLower.includes('karmfr')) && (docLower.includes('light') || item.id.includes('KARMFR'))) overlap += 0.45;
  if ((qLower.includes('purse seine') || qLower.includes('mhmfr')) && (docLower.includes('purse seine') || item.id.includes('MHMFR'))) overlap += 0.45;
  if ((qLower.includes('biometric') || qLower.includes('sir creek') || qLower.includes('gjmfra')) && (docLower.includes('biometric') || item.id.includes('GJMFRA'))) overlap += 0.45;
  if ((qLower.includes('ramponkar') || qLower.includes('goa')) && (docLower.includes('ramponkar') || item.id.includes('GOA-MFRA'))) overlap += 0.45;
  if ((qLower.includes('kallakkadal') || qLower.includes('swell surge')) && (docLower.includes('kallakkadal') || item.id.includes('SWELL-KALLAKKADAL'))) overlap += 0.45;
  if ((qLower.includes('lifejacket') || qLower.includes('lsa') || qLower.includes('flares')) && (docLower.includes('lifejacket') || item.id.includes('LSA'))) overlap += 0.45;
  if ((qLower.includes('bycatch') || qLower.includes('whale shark') || qLower.includes('dugong') || qLower.includes('schedule i')) && (docLower.includes('bycatch') || item.id.includes('WPA-SCHED1'))) overlap += 0.45;
  if ((qLower.includes('navarea') || qLower.includes('navtex')) && (docLower.includes('navarea') || item.id.includes('NAVAREA'))) overlap += 0.45;
  if (qLower.includes('tsunami') && (docLower.includes('tsunami') || item.id.includes('TSUNAMI'))) overlap += 0.45;
  if ((qLower.includes('squall') || qLower.includes('small craft advisory')) && (docLower.includes('squall') || item.id.includes('SQUALL'))) overlap += 0.40;
  if (qLower.includes('4-stage') && (docLower.includes('4-stage') || item.id.includes('4STAGE'))) overlap += 0.45;
  if ((qLower.includes('colreg') || qLower.includes('tss')) && (docLower.includes('colreg') || item.id.includes('COLREG'))) overlap += 0.45;

  return overlap;
}

export function retrieveEvidence(query: string, location: LocationInfo, riskLevel: string): EvidenceItem[] {
  const normalizedLocation = normalize(`${location.name} ${location.state || ''} ${location.country}`);
  const coast = resolveCoastFromLocation(location);
  const qLower = query.toLowerCase();

  return MARINE_EVIDENCE_CORPUS.map(item => {
    const lexicalScore = lexicalRelevance(query, item);
    const locationText = normalize(`${item.title} ${item.excerpt}`);
    const locationMatch = normalizedLocation.some(token => locationText.includes(token)) ? 0.05 : 0;
    const authorityBoost = (riskLevel === 'HIGH' || riskLevel === 'EXTREME') &&
      (item.id.includes('IMD') || item.id.includes('INCOIS') || item.id.includes('ICG')) ? 0.05 : 0;

    // Geographic alignment boost / penalty
    let geoAdjustment = 0;
    if (item.coast && item.coast !== 'all' && coast !== 'all') {
      if (item.coast === coast) {
        geoAdjustment += 0.08;
      } else if (!qLower.includes(item.coast)) {
        // Query didn't explicitly ask for the opposite coast; dampen score to prevent mismatch
        geoAdjustment -= 0.15;
      }
    }

    if (item.applicableStates && location.state && item.applicableStates.includes(location.state)) {
      geoAdjustment += 0.12;
    }

    const blendedScore = Math.max(
      0.10,
      Math.min(
        0.99,
        lexicalScore * 0.70 + item.relevanceScore * 0.20 + locationMatch + authorityBoost + geoAdjustment,
      ),
    );

    return { ...item, relevanceScore: Number(blendedScore.toFixed(2)), _rawLexical: lexicalScore };
  })
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b._rawLexical - a._rawLexical)
    .map(({ _rawLexical, ...item }) => item)
    .slice(0, 8);
}

export function getLocationByKey(key: string): LocationInfo {
  return COASTAL_LOCATIONS[key] || COASTAL_LOCATIONS.digha;
}
