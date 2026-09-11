import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARINE_EVIDENCE_CORPUS } from '../../../frontend/src/data/coastalData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '../../ml-service/data/evidence');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outFile = path.join(outDir, 'statutory_marine_corpus.json');
fs.writeFileSync(outFile, JSON.stringify(MARINE_EVIDENCE_CORPUS, null, 2), 'utf-8');
console.log(`[OK] Exported ${MARINE_EVIDENCE_CORPUS.length} statutory evidence documents to ${outFile}`);
