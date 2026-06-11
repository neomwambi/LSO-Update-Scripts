import * as XLSX from 'xlsx';

const POLICY_RE = /^[A-Za-z0-9\-]+$/;

export function normalizeName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function padRow(r, len) {
  const out = Array(len).fill('');
  if (!Array.isArray(r)) return out;
  for (let i = 0; i < len; i++) out[i] = r[i] ?? '';
  return out;
}

function isRowEmpty(cols) {
  return cols.every((c) => String(c ?? '').trim() === '');
}

export function parseDobToSql(cell) {
  if (cell === '' || cell === null || cell === undefined) return null;
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof cell === 'number' && XLSX.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(cell);
    if (parsed && parsed.y) {
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${parsed.y}-${m}-${d}`;
    }
  }
  const s = String(cell).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

const LESOTHO_ID_LEN = 12;

/**
 * Lesotho national IDs are 12 digits. Excel often drops leading zeros when the cell is numeric.
 * Team rule: if there are 11 digits and the value does not start with 1, prepend one leading zero.
 * For fewer than 11 digits (digits only), left-pad with zeros to 12.
 * If there are 11 digits starting with 1, leave as-is (no extra zero) per agreement.
 */
export function normalizeLesothoIdNumber(cell) {
  if (cell === '' || cell === null || cell === undefined) return { id: null, warn: undefined };

  let raw;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    raw = String(Math.trunc(cell));
  } else {
    raw = String(cell).trim().replace(/\s+/g, '');
    if (raw.startsWith("'")) raw = raw.slice(1);
  }

  if (!raw) return { id: null, warn: undefined };

  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return { id: raw === '' ? null : raw.trim(), warn: undefined };
  }

  if (digits.length > LESOTHO_ID_LEN) {
    return {
      id: digits,
      warn: `ID has ${digits.length} digits (expected ${LESOTHO_ID_LEN}); left unchanged.`,
    };
  }

  if (digits.length === LESOTHO_ID_LEN) {
    return { id: digits, warn: undefined };
  }

  if (digits.length === 11) {
    if (digits.startsWith('1')) {
      return {
        id: digits,
        warn:
          'ID has 11 digits and starts with 1; no leading zero was added (per Lesotho rule). If the real ID is 12 digits with a leading 0, format column D as Text in Excel or prefix with \'',
      };
    }
    return { id: `0${digits}`, warn: undefined };
  }

  return { id: digits.padStart(LESOTHO_ID_LEN, '0'), warn: undefined };
}

export function isValidPolicy(policy) {
  return POLICY_RE.test(policy);
}

/**
 * Columns: A owner first, B owner surname, C policy, D id, E dob, F benefit full name
 */
export function parseBenefitWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });

  const errors = [];
  const warnings = [];
  if (!rows.length) {
    return { sheetName, dataRows: [], mergedTargets: [], errors: ['Workbook is empty'], warnings };
  }

  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = padRow(rows[i], 6);
    if (isRowEmpty(cols)) continue;

    const policy = String(cols[2] ?? '').trim();
    const benefitName = String(cols[5] ?? '').trim();
    const ownerFirst = String(cols[0] ?? '').trim();
    const ownerSurname = String(cols[1] ?? '').trim();

    if (!policy || !benefitName) {
      errors.push(`Row ${i + 1}: policy number (C) and benefit name (F) are required.`);
      continue;
    }
    if (!isValidPolicy(policy)) {
      errors.push(`Row ${i + 1}: policy "${policy}" uses unsupported characters.`);
      continue;
    }

    const idNorm = normalizeLesothoIdNumber(cols[3]);
    const idNumber = idNorm.id === null || idNorm.id === '' ? null : idNorm.id;
    if (idNorm.warn) {
      warnings.push(`Row ${i + 1} (column D): ${idNorm.warn}`);
    }
    const dobSql = parseDobToSql(cols[4]);

    if (!idNumber && !dobSql) {
      warnings.push(`Row ${i + 1}: no ID (D) or DOB (E); row will only drive lookups if other fields matter.`);
    }

    dataRows.push({
      rowIndex: i + 1,
      ownerFirst,
      ownerSurname,
      policy,
      idNumber,
      dobSql,
      benefitName,
    });
  }

  const mergedTargets = mergeTargetsByPolicyBenefit(dataRows, errors);

  return { sheetName, dataRows, mergedTargets, errors, warnings };
}

function mergeTargetsByPolicyBenefit(dataRows, errors) {
  /** @type {Map<string, object>} */
  const map = new Map();
  for (const row of dataRows) {
    const key = `${row.policy}||${normalizeName(row.benefitName)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
      continue;
    }
    const sameDob = (existing.dobSql || null) === (row.dobSql || null);
    const sameId = (existing.idNumber || null) === (row.idNumber || null);
    const sameOwner =
      normalizeName(`${existing.ownerFirst} ${existing.ownerSurname}`) ===
      normalizeName(`${row.ownerFirst} ${row.ownerSurname}`);
    if (sameDob && sameId && sameOwner) continue;
    if (!sameDob || !sameId) {
      errors.push(
        `Conflicting D/E for same policy "${row.policy}" and benefit "${row.benefitName}" (rows ${existing.rowIndex} vs ${row.rowIndex}).`
      );
      continue;
    }
    if (!sameOwner) {
      errors.push(
        `Same policy/benefit but different owner A/B on rows ${existing.rowIndex} vs ${row.rowIndex}.`
      );
    }
  }
  return [...map.values()];
}
