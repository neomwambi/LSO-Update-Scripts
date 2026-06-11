import { parseBenefitWorkbook, normalizeName } from './excelParser.js';
import { runLookup, buildLookupSql } from './lookup.js';
import {
  buildPolicyRolePlayerDobUpdate,
  buildPolicyRolePlayerIdUpdate,
  buildIndividualUpdate,
  buildPolicyIdUpdate,
  classifyPolicyRolePlayerIds,
  classifyIndividualIds,
  buildPolicyRolePlayerSearchMetaUpdate,
  buildIndividualSearchMetaUpdate,
  buildPolicySearchMetaUpdate,
  buildPreviewPolicyRolePlayerDob,
  buildPreviewPolicyRolePlayerId,
  buildPreviewIndividual,
  buildPreviewPolicy,
  buildPreviewPolicyRolePlayerSearchMeta,
  buildPreviewIndividualSearchMeta,
  buildPreviewPolicySearchMeta,
} from './sqlGen.js';

function buildLookupSqlText(uniqueNames, uniquePolicies) {
  const namePh = uniqueNames.map(() => '?').join(',');
  const polPh = uniquePolicies.map(() => '?').join(',');
  return buildLookupSql(namePh, polPh);
}

async function runCount(pool, countSql) {
  if (!pool) return null;
  if (!countSql?.trim()) return 0;
  const [rows] = await pool.query(countSql);
  const n = rows[0]?.cnt;
  return typeof n === 'bigint' ? Number(n) : Number(n);
}

/**
 * @param {Buffer} buffer
 * @param {import('mysql2/promise').Pool | null} pool
 */
export async function processWorkbook(buffer, pool) {
  const parsed = parseBenefitWorkbook(buffer);
  const warnings = [...parsed.warnings];
  const errors = [...parsed.errors];

  if (errors.length) {
    return {
      ok: false,
      errors,
      warnings,
      sheetName: parsed.sheetName,
      mergedRowCount: parsed.mergedTargets.length,
    };
  }

  const merged = parsed.mergedTargets;
  const uniquePolicies = [...new Set(merged.map((r) => r.policy))].sort();
  const uniqueNames = [...new Set(merged.map((r) => r.benefitName.trim()))].sort();

  const lookupSqlParameterized = buildLookupSqlText(uniqueNames, uniquePolicies);

  let lookupRows = [];
  if (pool) {
    try {
      lookupRows = await runLookup(pool, uniqueNames, uniquePolicies);
    } catch (e) {
      return {
        ok: false,
        errors: [`Lookup query failed: ${e.message}`],
        warnings,
        sheetName: parsed.sheetName,
        lookupSqlParameterized,
        uniqueNames,
        uniquePolicies,
      };
    }
  } else {
    warnings.push('No database connection: upload returned parsed rows and lookup SQL only.');
  }

  const lookupByKey = new Map();
  for (const lr of lookupRows) {
    const key = `${lr.UniquePolicyNumber}||${normalizeName(lr.FullName)}`;
    if (!lookupByKey.has(key)) lookupByKey.set(key, { rolePlayerIds: new Set(), individualIds: new Set() });
    const g = lookupByKey.get(key);
    g.rolePlayerIds.add(Number(lr.RolePlayerId));
    if (lr.IndividualId != null && lr.IndividualId !== '') {
      g.individualIds.add(Number(lr.IndividualId));
    }
  }

  const noMatch = [];
  for (const t of merged) {
    const key = `${t.policy}||${normalizeName(t.benefitName)}`;
    const lu = lookupByKey.get(key);
    if (!lu || lu.rolePlayerIds.size === 0) {
      noMatch.push({
        policy: t.policy,
        benefitName: t.benefitName,
        rowIndex: t.rowIndex,
        ownerFirst: t.ownerFirst,
        ownerSurname: t.ownerSurname,
      });
    }
  }
  if (noMatch.length && pool) {
    warnings.push(
      `${noMatch.length} target(s) had no matching role player for policy + benefit name (column F). Check VPN, spelling, or how the name is stored in the DB:`
    );
    for (const n of [...noMatch].sort((a, b) => a.rowIndex - b.rowIndex)) {
      const owner = [n.ownerFirst, n.ownerSurname].filter(Boolean).join(' ').trim();
      const ownerPart = owner ? ` · policy owner (A+B): ${owner}` : '';
      warnings.push(`Row ${n.rowIndex}: ${n.policy} - benefit "${n.benefitName}"${ownerPart}`);
    }
  }

  const mergeErrors = [];

  /** @type {Map<number, { idNumber: string|null, dobSql: string|null, label: string }>} */
  const individualMap = new Map();
  for (const t of merged) {
    const key = `${t.policy}||${normalizeName(t.benefitName)}`;
    const lu = lookupByKey.get(key);
    if (!lu) continue;
    for (const iid of lu.individualIds) {
      const cur = individualMap.get(iid);
      if (!cur) {
        individualMap.set(iid, {
          idNumber: t.idNumber ?? null,
          dobSql: t.dobSql ?? null,
          label: t.benefitName,
        });
        continue;
      }
      if (t.idNumber) {
        if (!cur.idNumber) cur.idNumber = t.idNumber;
        else if (cur.idNumber !== t.idNumber) {
          mergeErrors.push(
            `Individual Id ${iid}: column D maps to more than one new ID number across rows.`
          );
        }
      }
      if (t.dobSql) {
        if (!cur.dobSql) cur.dobSql = t.dobSql;
        else if (cur.dobSql !== t.dobSql) {
          mergeErrors.push(`Individual Id ${iid}: column E maps to more than one new DOB across rows.`);
        }
      }
      if (!cur.label?.trim() && t.benefitName?.trim()) {
        cur.label = t.benefitName;
      }
    }
  }

  /** @type {Map<string, string>} */
  const policyId = new Map();
  for (const t of merged) {
    const ownerFull = normalizeName(`${t.ownerFirst} ${t.ownerSurname}`);
    const ben = normalizeName(t.benefitName);
    if (ownerFull && ownerFull === ben && t.idNumber) {
      const existing = policyId.get(t.policy);
      if (existing && existing !== t.idNumber) {
        mergeErrors.push(`Policy ${t.policy}: more than one new owner ID in column D.`);
      }
      policyId.set(t.policy, t.idNumber);
    }
  }

  if (mergeErrors.length) {
    return {
      ok: false,
      errors: mergeErrors,
      warnings,
      sheetName: parsed.sheetName,
      noMatch,
      lookupSqlParameterized,
      uniqueNames,
      uniquePolicies,
      mergedRowCount: merged.length,
    };
  }

  /** @type {Map<string, { ids: Set<number>, label: string }>} */
  const rpDob = new Map();
  /** @type {Map<string, { ids: Set<number>, label: string }>} */
  const rpId = new Map();

  for (const t of merged) {
    const key = `${t.policy}||${normalizeName(t.benefitName)}`;
    const lu = lookupByKey.get(key);
    if (!lu) continue;
    const label = t.benefitName;
    if (t.dobSql) {
      if (!rpDob.has(t.dobSql)) rpDob.set(t.dobSql, { ids: new Set(), label });
      const bucket = rpDob.get(t.dobSql);
      lu.rolePlayerIds.forEach((id) => bucket.ids.add(id));
    }
    if (t.idNumber) {
      if (!rpId.has(t.idNumber)) rpId.set(t.idNumber, { ids: new Set(), label });
      const bucket = rpId.get(t.idNumber);
      lu.rolePlayerIds.forEach((id) => bucket.ids.add(id));
    }
  }

  const individualForSql = new Map();
  for (const [iid, v] of individualMap) {
    if (v.idNumber || v.dobSql) {
      individualForSql.set(iid, {
        idNumber: v.idNumber,
        dobSql: v.dobSql,
        label: (v.label || '').trim() || `Individual ${iid}`,
      });
    }
  }

  const prpDobScript = buildPolicyRolePlayerDobUpdate(rpDob);
  const prpIdScript = buildPolicyRolePlayerIdUpdate(rpId);
  const indScript = buildIndividualUpdate(individualForSql);
  const polScript = buildPolicyIdUpdate(policyId);

  const prpClass = classifyPolicyRolePlayerIds(rpDob, rpId);
  const indClass = classifyIndividualIds(individualForSql);

  const prpSmScript = buildPolicyRolePlayerSearchMetaUpdate(prpClass);
  const indSmScript = buildIndividualSearchMetaUpdate(indClass);
  const polSmScript = buildPolicySearchMetaUpdate(policyId);

  const prevPrpDob = buildPreviewPolicyRolePlayerDob(rpDob);
  const prevPrpId = buildPreviewPolicyRolePlayerId(rpId);
  const prevInd = buildPreviewIndividual(individualForSql);
  const prevPol = buildPreviewPolicy(policyId);
  const prevPrpSm = buildPreviewPolicyRolePlayerSearchMeta(prpClass);
  const prevIndSm = buildPreviewIndividualSearchMeta(indClass);
  const prevPolSm = buildPreviewPolicySearchMeta(policyId);

  let previewCounts = null;
  let totalPreviewRows = null;

  if (pool) {
    const c1 = await runCount(pool, prevPrpDob.countSql);
    const c2 = await runCount(pool, prevPrpId.countSql);
    const c3 = await runCount(pool, prevInd.countSql);
    const c4 = await runCount(pool, prevPol.countSql);
    const c5 = await runCount(pool, prevPrpSm.countSql);
    const c6 = await runCount(pool, prevIndSm.countSql);
    const c7 = await runCount(pool, prevPolSm.countSql);
    previewCounts = {
      policyroleplayer_dob: c1,
      policyroleplayer_id: c2,
      individual: c3,
      policy_id: c4,
      policyroleplayer_searchmeta: c5,
      individual_searchmeta: c6,
      policy_searchmeta: c7,
    };
    totalPreviewRows = (c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) + (c4 ?? 0) + (c5 ?? 0) + (c6 ?? 0) + (c7 ?? 0);
  }

  return {
    ok: true,
    errors: [],
    warnings,
    sheetName: parsed.sheetName,
    mergedRowCount: merged.length,
    lookupRowCount: lookupRows.length,
    noMatch,
    lookupSqlParameterized,
    uniqueNames,
    uniquePolicies,
    scripts: {
      policyroleplayer_dob: prpDobScript.sql,
      policyroleplayer_id: prpIdScript.sql,
      individual: indScript.sql,
      policy_id: polScript.sql,
      policyroleplayer_searchmeta: prpSmScript.sql,
      individual_searchmeta: indSmScript.sql,
      policy_searchmeta: polSmScript.sql,
    },
    previews: {
      policyroleplayer_dob: prevPrpDob.sql,
      policyroleplayer_id: prevPrpId.sql,
      individual: prevInd.sql,
      policy_id: prevPol.sql,
      policyroleplayer_searchmeta: prevPrpSm.sql,
      individual_searchmeta: prevIndSm.sql,
      policy_searchmeta: prevPolSm.sql,
    },
    previewCounts,
    totalPreviewRows,
  };
}
