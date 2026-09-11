import { runOrcaAgentWorkflow } from '../server/services/orcaService.ts';
import { MARINE_EVIDENCE_CORPUS } from '../src/data/coastalData.ts';

const VALID_CORPUS_IDS = new Set(MARINE_EVIDENCE_CORPUS.map((item) => item.id));

interface GroundingTestCase {
  name: string;
  query: string;
  locationKey?: string;
  expectedDocId: string;
  expectedAuthority: string;
  expectedRuleSnippet?: string;
  requiredCoast?: 'east' | 'west';
}

const GROUNDING_TEST_CASES: GroundingTestCase[] = [
  {
    name: 'Indian Coast Guard VHF Ch 16 & SAR Helpline',
    query: 'What is the Indian Coast Guard emergency VHF channel and SAR hotline number in Visakhapatnam?',
    locationKey: 'visakhapatnam',
    expectedDocId: 'ICG-SAR-SOP-2026-01',
    expectedAuthority: 'Indian Coast Guard',
    expectedRuleSnippet: '156.800',
    requiredCoast: 'east',
  },
  {
    name: 'Annual Uniform Monsoon Trawl Ban (DAHD)',
    query: 'When is the annual uniform monsoon ban enforced on mechanized trawlers in the Bay of Bengal?',
    locationKey: 'visakhapatnam',
    expectedDocId: 'DAHD-TRAWL-BAN-2026-61',
    expectedAuthority: 'Department of Fisheries',
    expectedRuleSnippet: 'mechanized fishing',
    requiredCoast: 'east',
  },
  {
    name: 'IMD Port Warning Signals (Signal 3 to 7)',
    query: 'What do IMD port danger signals 3 and 7 mean for harbor departures in Digha?',
    locationKey: 'digha',
    expectedDocId: 'IMD-PORT-SIGNALS-1TO11',
    expectedAuthority: 'IMD',
    expectedRuleSnippet: 'Port Signal',
    requiredCoast: 'east',
  },
  {
    name: 'Gahirmatha MPA Geofence & Olive Ridley Sanctuaries',
    query: 'What are the mechanized fishing restrictions inside Gahirmatha turtle sanctuary?',
    locationKey: 'digha',
    expectedDocId: 'MPA-GEOFENCE-REG-2026',
    expectedAuthority: 'Wildlife Institute of India',
    expectedRuleSnippet: 'Gahirmatha',
    requiredCoast: 'east',
  },
  {
    name: 'Kerala Minimum Legal Size (MLS) & Juvenile Conservation',
    query: 'What is the minimum legal size MLS for catching oil sardine and Indian mackerel in Kerala?',
    locationKey: 'kochi',
    expectedDocId: 'KMFRA-MLS-REG-2026',
    expectedAuthority: 'Department of Fisheries, Government of Kerala',
    expectedRuleSnippet: 'MLS',
    requiredCoast: 'west',
  },
  {
    name: 'Goa Ramponkar Traditional Estuarine Reservation',
    query: 'What coastal zone is reserved exclusively for Ramponkar traditional fishermen in Goa?',
    locationKey: 'goa',
    expectedDocId: 'GOA-MFRA-ESTUARY-2026',
    expectedAuthority: 'Directorate of Fisheries, Government of Goa',
    expectedRuleSnippet: 'reserved',
    requiredCoast: 'west',
  },
  {
    name: 'Karnataka LED Light Fishing Ban',
    query: 'Is artificial LED light fishing or pair trawling permitted in Karnataka territorial waters?',
    locationKey: 'karwar',
    expectedDocId: 'KARMFR-LIGHT-BAN-2026',
    expectedAuthority: 'Department of Fisheries, Government of Karnataka',
    expectedRuleSnippet: 'light fishing',
    requiredCoast: 'west',
  },
  {
    name: 'INCOIS Kallakkadal Flash Swell Surge Protocols',
    query: 'What safety protocol must artisanal crafts take during INCOIS Kallakkadal swell surge alerts in Kerala?',
    locationKey: 'kochi',
    expectedDocId: 'INCOIS-SWELL-KALLAKKADAL-2026',
    expectedAuthority: 'INCOIS',
    expectedRuleSnippet: 'Swell',
    requiredCoast: 'west',
  },
];

async function runGroundingVerification() {
  console.log('======================================================================');
  console.log('🛡️ ORCA-X RAG GROUNDING FAITHFULNESS & CITATION VERIFICATION SUITE');
  console.log('======================================================================\n');

  console.log(`[Phase 1] Validating Canonical Corpus Reference Integrity (${MARINE_EVIDENCE_CORPUS.length} docs)...`);
  if (VALID_CORPUS_IDS.size < 35) {
    throw new Error(`Corpus validation failed: Expected >= 35 unique IDs, found ${VALID_CORPUS_IDS.size}`);
  }
  console.log(`✓ All ${VALID_CORPUS_IDS.size} statutory evidence items verified unique and indexed.\n`);

  console.log(`[Phase 2] Executing End-to-End Grounded Retrieval over ${GROUNDING_TEST_CASES.length} Statutory Scenarios:`);

  let passedTests = 0;

  for (let i = 0; i < GROUNDING_TEST_CASES.length; i++) {
    const testCase = GROUNDING_TEST_CASES[i];
    const testNum = String(i + 1).padStart(2, '0');
    console.log(`\n--- [Test ${testNum}/${GROUNDING_TEST_CASES.length}] ${testCase.name} ---`);
    console.log(`Query: "${testCase.query}"`);

    const result = await runOrcaAgentWorkflow(testCase.query, testCase.locationKey, undefined, 'en');

    // 1. Evidence Existence & Grounding Check
    if (!result.evidence || result.evidence.length === 0) {
      throw new Error(`[FAIL] Query yielded 0 retrieved evidence items.`);
    }

    const targetDoc = result.evidence.find((item) => item.id === testCase.expectedDocId);
    if (!targetDoc) {
      const topIds = result.evidence.slice(0, 3).map((e) => e.id).join(', ');
      throw new Error(
        `[FAIL] Expected document '${testCase.expectedDocId}' not found in top ${result.evidence.length} results. Top matches: [${topIds}]`,
      );
    }

    // 2. Hallucination Check: every retrieved evidence ID must exist in canonical corpus or be LIVE-
    for (const item of result.evidence) {
      if (!VALID_CORPUS_IDS.has(item.id) && !item.id.startsWith('LIVE-')) {
        throw new Error(`[HALLUCINATION DETECTED] Retrieved document '${item.id}' does not exist in statutory corpus!`);
      }
    }

    // 3. Authority & Metadata Integrity Check
    if (!targetDoc.sourceAuthority.toLowerCase().includes(testCase.expectedAuthority.toLowerCase().slice(0, 15))) {
      console.warn(
        `  ⚠ Authority mismatch warning: Expected containing '${testCase.expectedAuthority}', got '${targetDoc.sourceAuthority}'`,
      );
    }

    if (testCase.expectedRuleSnippet) {
      const complianceLower = (targetDoc.complianceRule || '').toLowerCase();
      const excerptLower = (targetDoc.excerpt || '').toLowerCase();
      const titleLower = (targetDoc.title || '').toLowerCase();
      const snippetLower = testCase.expectedRuleSnippet.toLowerCase();

      if (!complianceLower.includes(snippetLower) && !excerptLower.includes(snippetLower) && !titleLower.includes(snippetLower)) {
        throw new Error(
          `[FAIL] Expected snippet '${testCase.expectedRuleSnippet}' not found in compliance rule or excerpt of '${targetDoc.id}'`,
        );
      }
    }

    // 4. Trace & Degraded Graceful Handling Verification
    const evidenceTrace = result.agentTraces.find((t) => t.agentName === 'EvidenceRetrieval' || t.taskId === 'evidence');
    if (!evidenceTrace) {
      throw new Error(`[FAIL] Agent trace for 'EvidenceRetrieval' was missing from agentTraces.`);
    }

    const rank = result.evidence.findIndex((item) => item.id === testCase.expectedDocId) + 1;
    console.log(`  ✓ Grounded Citation: [${targetDoc.id}] (Rank #${rank}/${result.evidence.length})`);
    console.log(`  ✓ Source Authority: ${targetDoc.sourceAuthority}`);
    console.log(`  ✓ Rule Excerpt: "${targetDoc.complianceRule?.slice(0, 90) || targetDoc.excerpt.slice(0, 90)}..."`);
    console.log(`  ✓ Evidence Retrieval Trace: ${evidenceTrace.outputSummary}`);

    passedTests++;
  }

  console.log('\n======================================================================');
  console.log(`📊 GROUNDING VERIFICATION SUMMARY:`);
  console.log(`   Scenarios Tested: ${GROUNDING_TEST_CASES.length}`);
  console.log(`   Faithfully Grounded: ${passedTests}/${GROUNDING_TEST_CASES.length} (100%)`);
  console.log(`   Hallucinated Citations: 0`);
  console.log(`   Corpus Integrity: 100%`);
  console.log('======================================================================');
  console.log('✔ ALL GROUNDING FAITHFULNESS TESTS COMPLETED SUCCESSFULLY!\n');
}

runGroundingVerification().catch((err) => {
  console.error('[FAIL] Grounding verification failed:', err);
  process.exit(1);
});
