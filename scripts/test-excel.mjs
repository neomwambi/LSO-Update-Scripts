/**
 * Offline test: parse workbook and print generated SQL (no DB).
 * Usage: node scripts/test-excel.mjs [path-to.xlsx]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processWorkbook } from '../server/processWorkbook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultXlsx = path.join(
  __dirname,
  '..',
  '..',
  'Lesotho DOB and ID Changes Master Template (12).xlsx'
);
const xlsxPath = process.argv[2] || defaultXlsx;

if (!fs.existsSync(xlsxPath)) {
  console.error('File not found:', xlsxPath);
  process.exit(1);
}

const buf = fs.readFileSync(xlsxPath);
const result = await processWorkbook(buf, null);

console.log('--- Summary (no DB / lookup not run) ---');
console.log(JSON.stringify(
  {
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    sheetName: result.sheetName,
    mergedRowCount: result.mergedRowCount,
    uniqueNamesCount: result.uniqueNames?.length,
    uniquePoliciesCount: result.uniquePolicies?.length,
  },
  null,
  2
));

if (result.scripts) {
  const keys = [
    'policyroleplayer_dob',
    'policyroleplayer_id',
    'individual',
    'policy_id',
  ];
  for (const k of keys) {
    const sql = result.scripts[k] || '';
    const head = sql.slice(0, 600);
    console.log('\n---', k, '--- length:', sql.length);
    console.log(head + (sql.length > 600 ? '\n... [truncated]' : ''));
  }
}
