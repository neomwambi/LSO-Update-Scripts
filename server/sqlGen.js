export function sqlSafeComment(label) {
  return String(label).replace(/[\r\n]/g, ' ').replace(/--/g, '- ').slice(0, 120);
}

/** SQL string literal for SearchMetaInfo audit text (LSO Lesotho client file). */
function sqlLit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export const SEARCH_META = {
  /** policyroleplayer + individual: DOB only */
  dobOnly: 'Date of birth updated from LSO Lesotho client file.',
  /** policyroleplayer + individual: ID only */
  idOnly: 'ID number updated from LSO Lesotho client file.',
  /** policyroleplayer + individual: both columns */
  dobAndId: 'Date of birth and ID number updated from LSO Lesotho client file.',
  /** policy: owner ID */
  policyIdOnly: 'Policy owner ID number updated from LSO Lesotho client file.',
};

/**
 * Flatten role-player id sets from DOB / ID group maps.
 */
export function classifyPolicyRolePlayerIds(rpDob, rpId) {
  const dobIds = new Set();
  for (const { ids } of rpDob.values()) {
    ids.forEach((id) => dobIds.add(id));
  }
  const idIds = new Set();
  for (const { ids } of rpId.values()) {
    ids.forEach((id) => idIds.add(id));
  }
  return classifyFromChangingIdSets(dobIds, idIds);
}

/** Classify SearchMetaInfo targets from sets that would actually change (live DB or Excel intent). */
export function classifyFromChangingIdSets(dobChangingIds, idChangingIds) {
  const both = new Set();
  for (const id of dobChangingIds) {
    if (idChangingIds.has(id)) both.add(id);
  }
  const dobOnly = new Set();
  for (const id of dobChangingIds) {
    if (!both.has(id)) dobOnly.add(id);
  }
  const idOnly = new Set();
  for (const id of idChangingIds) {
    if (!both.has(id)) idOnly.add(id);
  }
  return { dobOnly, idOnly, both };
}

/**
 * @param {Map<number, { idNumber: string|null, dobSql: string|null, label?: string }>} byIndividual
 */
export function classifyIndividualIds(byIndividual) {
  const dobIds = new Set();
  const idIds = new Set();
  for (const [iid, t] of byIndividual) {
    if (t.dobSql) dobIds.add(iid);
    if (t.idNumber) idIds.add(iid);
  }
  return classifyFromChangingIdSets(dobIds, idIds);
}

/**
 * @param {{ dobOnly: Set<number>, idOnly: Set<number>, both: Set<number> }} c
 */
export function buildPolicyRolePlayerSearchMetaUpdate(c) {
  const union = new Set([...c.dobOnly, ...c.idOnly, ...c.both]);
  if (!union.size) return { sql: '', affectedIds: new Set() };

  const branches = [];
  if (c.both.size) {
    branches.push(`WHEN prp.Id IN (${formatInList(c.both)}) THEN ${sqlLit(SEARCH_META.dobAndId)}`);
  }
  if (c.dobOnly.size) {
    branches.push(`WHEN prp.Id IN (${formatInList(c.dobOnly)}) THEN ${sqlLit(SEARCH_META.dobOnly)}`);
  }
  if (c.idOnly.size) {
    branches.push(`WHEN prp.Id IN (${formatInList(c.idOnly)}) THEN ${sqlLit(SEARCH_META.idOnly)}`);
  }

  const metaCase = wrapCase(branches, 'prp.SearchMetaInfo');
  const idList = formatInList(union);
  const changeFilter = wouldChangeCondition('prp.SearchMetaInfo', metaCase);
  const sql = `UPDATE policies_prod.policyroleplayer prp
SET prp.SearchMetaInfo = ${metaCase}
WHERE prp.Id IN (${idList})
  AND ${changeFilter};`;

  return {
    sql,
    affectedIds: union,
    countSql: countRowsSql(
      `policies_prod.policyroleplayer prp WHERE prp.Id IN (${idList}) AND ${changeFilter}`
    ),
  };
}

/**
 * @param {{ dobOnly: Set<number>, idOnly: Set<number>, both: Set<number> }} c
 */
export function buildIndividualSearchMetaUpdate(c) {
  const union = new Set([...c.dobOnly, ...c.idOnly, ...c.both]);
  if (!union.size) return { sql: '', affectedIds: new Set() };

  const branches = [];
  if (c.both.size) {
    branches.push(`WHEN i.Id IN (${formatInList(c.both)}) THEN ${sqlLit(SEARCH_META.dobAndId)}`);
  }
  if (c.dobOnly.size) {
    branches.push(`WHEN i.Id IN (${formatInList(c.dobOnly)}) THEN ${sqlLit(SEARCH_META.dobOnly)}`);
  }
  if (c.idOnly.size) {
    branches.push(`WHEN i.Id IN (${formatInList(c.idOnly)}) THEN ${sqlLit(SEARCH_META.idOnly)}`);
  }

  const idsList = sortIds(union).join(',');
  const metaCase = wrapCase(branches, 'i.SearchMetaInfo');
  const changeFilter = wouldChangeCondition('i.SearchMetaInfo', metaCase);
  const sql = `UPDATE members_prod.individual i
SET i.SearchMetaInfo = ${metaCase}
WHERE i.Id IN (${idsList})
  AND ${changeFilter};`;

  return {
    sql,
    affectedIds: union,
    countSql: countRowsSql(
      `members_prod.individual i WHERE i.Id IN (${idsList}) AND ${changeFilter}`
    ),
  };
}

/**
 * @param {Map<string, string>} policyToId
 */
export function buildPolicySearchMetaUpdate(policyToId) {
  if (!policyToId.size) return { sql: '', policies: new Set() };
  const polList = [...policyToId.keys()]
    .sort()
    .map((pol) => `'${pol.replace(/'/g, "''")}'`)
    .join(',');
  const msg = sqlLit(SEARCH_META.policyIdOnly);
  const changeFilter = wouldChangeCondition('p.SearchMetaInfo', msg);
  const sql = `UPDATE policies_prod.policy p
SET p.SearchMetaInfo = ${msg}
WHERE p.UniquePolicyNumber IN (${polList})
  AND ${changeFilter};`;
  return {
    sql,
    policies: new Set(policyToId.keys()),
    countSql: countRowsSql(
      `policies_prod.policy p WHERE p.UniquePolicyNumber IN (${polList}) AND ${changeFilter}`
    ),
  };
}

export function buildPreviewPolicyRolePlayerSearchMeta(c) {
  const union = new Set([...c.dobOnly, ...c.idOnly, ...c.both]);
  if (!union.size) return { sql: '', countSql: '' };

  const branches = [];
  if (c.both.size) {
    branches.push(`WHEN prp.Id IN (${formatInList(c.both)}) THEN ${sqlLit(SEARCH_META.dobAndId)}`);
  }
  if (c.dobOnly.size) {
    branches.push(`WHEN prp.Id IN (${formatInList(c.dobOnly)}) THEN ${sqlLit(SEARCH_META.dobOnly)}`);
  }
  if (c.idOnly.size) {
    branches.push(`WHEN prp.Id IN (${formatInList(c.idOnly)}) THEN ${sqlLit(SEARCH_META.idOnly)}`);
  }

  const inner = `SELECT 
        prp.Id,
        prp.SearchMetaInfo AS Current_SearchMetaInfo,
        CASE 
${branches.map((b) => '            ' + b).join('\n')}
            ELSE prp.SearchMetaInfo 
        END AS New_SearchMetaInfo
    FROM policies_prod.policyroleplayer prp
    WHERE prp.Id IN (${formatInList(union)})`;

  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE Current_SearchMetaInfo <> New_SearchMetaInfo 
   OR (Current_SearchMetaInfo IS NULL AND New_SearchMetaInfo IS NOT NULL);`;

  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE Current_SearchMetaInfo <> New_SearchMetaInfo 
   OR (Current_SearchMetaInfo IS NULL AND New_SearchMetaInfo IS NOT NULL);`;

  return { sql, countSql };
}

export function buildPreviewIndividualSearchMeta(c) {
  const union = new Set([...c.dobOnly, ...c.idOnly, ...c.both]);
  if (!union.size) return { sql: '', countSql: '' };

  const branches = [];
  if (c.both.size) {
    branches.push(`WHEN i.Id IN (${formatInList(c.both)}) THEN ${sqlLit(SEARCH_META.dobAndId)}`);
  }
  if (c.dobOnly.size) {
    branches.push(`WHEN i.Id IN (${formatInList(c.dobOnly)}) THEN ${sqlLit(SEARCH_META.dobOnly)}`);
  }
  if (c.idOnly.size) {
    branches.push(`WHEN i.Id IN (${formatInList(c.idOnly)}) THEN ${sqlLit(SEARCH_META.idOnly)}`);
  }

  const inner = `SELECT 
        i.Id,
        i.SearchMetaInfo AS Current_SearchMetaInfo,
        CASE 
${branches.map((b) => '            ' + b).join('\n')}
            ELSE i.SearchMetaInfo 
        END AS New_SearchMetaInfo
    FROM members_prod.individual i
    WHERE i.Id IN (${sortIds(union).join(',')})`;

  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE Current_SearchMetaInfo <> New_SearchMetaInfo 
   OR (Current_SearchMetaInfo IS NULL AND New_SearchMetaInfo IS NOT NULL);`;

  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE Current_SearchMetaInfo <> New_SearchMetaInfo 
   OR (Current_SearchMetaInfo IS NULL AND New_SearchMetaInfo IS NOT NULL);`;

  return { sql, countSql };
}

export function buildPreviewPolicySearchMeta(policyToId) {
  if (!policyToId.size) return { sql: '', countSql: '' };
  const polList = [...policyToId.keys()]
    .sort()
    .map((pol) => `'${pol.replace(/'/g, "''")}'`)
    .join(',');
  const newVal = sqlLit(SEARCH_META.policyIdOnly);
  const inner = `SELECT 
        p.UniquePolicyNumber,
        p.SearchMetaInfo AS Current_SearchMetaInfo,
        ${newVal} AS New_SearchMetaInfo
    FROM policies_prod.policy p
    WHERE p.UniquePolicyNumber IN (${polList})`;

  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE Current_SearchMetaInfo <> New_SearchMetaInfo 
   OR (Current_SearchMetaInfo IS NULL AND New_SearchMetaInfo IS NOT NULL);`;

  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE Current_SearchMetaInfo <> New_SearchMetaInfo 
   OR (Current_SearchMetaInfo IS NULL AND New_SearchMetaInfo IS NOT NULL);`;

  return { sql, countSql };
}

function sortIds(set) {
  return [...set].sort((a, b) => a - b);
}

function formatInList(ids) {
  return sortIds(ids).join(',');
}

/** Same row filter used in preview SELECTs: only rows where the new value differs. */
function wouldChangeCondition(currentExpr, newExpr) {
  return `(${currentExpr} <> ${newExpr} OR (${currentExpr} IS NULL AND ${newExpr} IS NOT NULL))`;
}

function wrapCase(branches, elseExpr) {
  return `CASE\n${branches.join('\n')}\nELSE ${elseExpr} END`;
}

function countRowsSql(fromWhereSql) {
  return `SELECT COUNT(*) AS cnt FROM ${fromWhereSql}`;
}

/**
 * @param {Map<string, { ids: Set<number>, label: string }>} groups - key = new DOB (YYYY-MM-DD)
 */
export function buildPolicyRolePlayerDobUpdate(groups) {
  if (!groups.size) return { sql: '', affectedIds: new Set() };
  const allIds = new Set();
  const branches = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dob, { ids, label }]) => {
      ids.forEach((id) => allIds.add(id));
      return `WHEN prp.Id IN (${formatInList(ids)}) THEN '${dob}' -- ${sqlSafeComment(label)}`;
    });
  const dobCase = wrapCase(branches, 'prp.DateOfBirth');
  const idList = formatInList(allIds);
  const changeFilter = wouldChangeCondition('prp.DateOfBirth', dobCase);
  const sql = `UPDATE policies_prod.policyroleplayer prp
SET prp.DateOfBirth = ${dobCase}
WHERE prp.Id IN (${idList})
  AND ${changeFilter};`;
  const whereClause = `policies_prod.policyroleplayer prp WHERE prp.Id IN (${idList}) AND ${changeFilter}`;
  return {
    sql,
    affectedIds: allIds,
    countSql: countRowsSql(whereClause),
    changingIdsSql: `SELECT prp.Id AS Id FROM ${whereClause}`,
  };
}

/**
 * @param {Map<string, { ids: Set<number>, label: string }>} groups - key = new ID number string
 */
export function buildPolicyRolePlayerIdUpdate(groups) {
  if (!groups.size) return { sql: '', affectedIds: new Set() };
  const allIds = new Set();
  const branches = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([idNum, { ids, label }]) => {
      ids.forEach((id) => allIds.add(id));
      const esc = String(idNum).replace(/'/g, "''");
      return `WHEN prp.Id IN (${formatInList(ids)}) THEN '${esc}' -- ${sqlSafeComment(label)}`;
    });
  const idCase = wrapCase(branches, 'prp.IDNumber');
  const idList = formatInList(allIds);
  const changeFilter = wouldChangeCondition('prp.IDNumber', idCase);
  const sql = `UPDATE policies_prod.policyroleplayer prp
SET prp.IDNumber = ${idCase}
WHERE prp.Id IN (${idList})
  AND ${changeFilter};`;
  const whereClause = `policies_prod.policyroleplayer prp WHERE prp.Id IN (${idList}) AND ${changeFilter}`;
  return {
    sql,
    affectedIds: allIds,
    countSql: countRowsSql(whereClause),
    changingIdsSql: `SELECT prp.Id AS Id FROM ${whereClause}`,
  };
}

/**
 * @param {Map<number, { idNumber: string|null, dobSql: string|null, label?: string }>} byIndividual
 */
function buildIndividualCases(byIndividual) {
  const ids = [...byIndividual.keys()].sort((a, b) => a - b);
  if (!ids.length) return null;

  const idBranches = [];
  const dobBranches = [];
  const needId = ids.some((i) => byIndividual.get(i).idNumber);
  const needDob = ids.some((i) => byIndividual.get(i).dobSql);

  for (const iid of ids) {
    const t = byIndividual.get(iid);
    const comment = sqlSafeComment(t.label || `Individual ${iid}`);
    if (needId && t.idNumber) {
      const esc = String(t.idNumber).replace(/'/g, "''");
      idBranches.push(`WHEN i.Id IN (${iid}) THEN '${esc}' -- ${comment}`);
    }
    if (needDob && t.dobSql) {
      dobBranches.push(`WHEN i.Id IN (${iid}) THEN '${t.dobSql}' -- ${comment}`);
    }
  }

  const idCase =
    idBranches.length > 0
      ? `CASE\n${idBranches.join('\n')}\nELSE i.IDNumber END`
      : 'i.IDNumber';
  const dobCase =
    dobBranches.length > 0
      ? `CASE\n${dobBranches.join('\n')}\nELSE i.DateOfBirth END`
      : 'i.DateOfBirth';

  return { ids, idList: ids.join(','), idCase, dobCase };
}

/**
 * @param {Map<number, { idNumber: string|null, dobSql: string|null, label?: string }>} byIndividual
 */
export function buildIndividualUpdate(byIndividual) {
  const spec = buildIndividualCases(byIndividual);
  if (!spec) return { sql: '', affectedIds: new Set() };

  const { idList, idCase, dobCase } = spec;
  const changeFilter = `(
   ${wouldChangeCondition('i.IDNumber', idCase)}
   OR
   ${wouldChangeCondition('i.DateOfBirth', dobCase)}
  )`;
  const sql = `UPDATE members_prod.individual i
SET
  i.IDNumber = ${idCase},
  i.DateOfBirth = ${dobCase}
WHERE i.Id IN (${idList})
  AND ${changeFilter};`;

  const whereClause = `members_prod.individual i WHERE i.Id IN (${idList}) AND ${changeFilter}`;
  const idWhere = `members_prod.individual i WHERE i.Id IN (${idList}) AND ${wouldChangeCondition('i.IDNumber', idCase)}`;
  const dobWhere = `members_prod.individual i WHERE i.Id IN (${idList}) AND ${wouldChangeCondition('i.DateOfBirth', dobCase)}`;

  return {
    sql,
    affectedIds: new Set(spec.ids),
    countSql: countRowsSql(whereClause),
    changingIdSql: `SELECT i.Id AS Id FROM ${idWhere}`,
    changingDobSql: `SELECT i.Id AS Id FROM ${dobWhere}`,
  };
}

/**
 * @param {Map<string, string>} policyToId - policy number -> new id
 */
export function buildPolicyIdUpdate(policyToId) {
  if (!policyToId.size) return { sql: '', policies: new Set() };
  /** @type {Map<string, Set<string>>} */
  const byNewId = new Map();
  for (const [pol, idNum] of policyToId) {
    const k = String(idNum);
    if (!byNewId.has(k)) byNewId.set(k, new Set());
    byNewId.get(k).add(pol);
  }
  const branches = [...byNewId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([idNum, policies]) => {
      const esc = String(idNum).replace(/'/g, "''");
      const list = [...policies]
        .sort()
        .map((pol) => `'${pol.replace(/'/g, "''")}'`)
        .join(',');
      return `WHEN p.UniquePolicyNumber IN (${list}) THEN '${esc}'`;
    });
  const polList = [...policyToId.keys()]
    .sort()
    .map((pol) => `'${pol.replace(/'/g, "''")}'`)
    .join(',');
  const idCase = wrapCase(branches, 'p.IDNumber');
  const changeFilter = wouldChangeCondition('p.IDNumber', idCase);
  const sql = `UPDATE policies_prod.policy p
SET p.IDNumber = ${idCase}
WHERE p.UniquePolicyNumber IN (${polList})
  AND ${changeFilter};`;
  const whereClause = `policies_prod.policy p WHERE p.UniquePolicyNumber IN (${polList}) AND ${changeFilter}`;
  return {
    sql,
    policies: new Set(policyToId.keys()),
    countSql: countRowsSql(whereClause),
    changingPoliciesSql: `SELECT p.UniquePolicyNumber AS UniquePolicyNumber FROM ${whereClause}`,
  };
}

export function buildPreviewPolicyRolePlayerDob(groups) {
  if (!groups.size) return { sql: '', countSql: '' };
  const { affectedIds } = buildPolicyRolePlayerDobUpdate(groups);
  if (!affectedIds.size) return { sql: '', countSql: '' };
  const inList = formatInList(affectedIds);
  const branches = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dob, { ids, label }]) => {
      return `WHEN prp.Id IN (${formatInList(ids)}) THEN '${dob}' -- ${sqlSafeComment(label)}`;
    });
  const inner = `SELECT 
        prp.Id,
        prp.DateOfBirth AS Current_DOB,
        CASE 
${branches.map((b) => '            ' + b).join('\n')}
            ELSE prp.DateOfBirth 
        END AS New_DOB
    FROM policies_prod.policyroleplayer prp
    WHERE prp.Id IN (${inList})`;
  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE Current_DOB <> New_DOB 
   OR (Current_DOB IS NULL AND New_DOB IS NOT NULL);`;
  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE Current_DOB <> New_DOB 
   OR (Current_DOB IS NULL AND New_DOB IS NOT NULL);`;
  return { sql, countSql };
}

export function buildPreviewPolicyRolePlayerId(groups) {
  if (!groups.size) return { sql: '', countSql: '' };
  const { affectedIds } = buildPolicyRolePlayerIdUpdate(groups);
  if (!affectedIds.size) return { sql: '', countSql: '' };
  const inList = formatInList(affectedIds);
  const branches = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([idNum, { ids, label }]) => {
      const esc = String(idNum).replace(/'/g, "''");
      return `WHEN prp.Id IN (${formatInList(ids)}) THEN '${esc}' -- ${sqlSafeComment(label)}`;
    });
  const inner = `SELECT 
        prp.Id,
        prp.IDNumber AS Current_IDNumber,
        CASE
${branches.map((b) => '            ' + b).join('\n')}
            ELSE prp.IDNumber 
        END AS New_IDNumber
    FROM policies_prod.policyroleplayer prp
    WHERE prp.Id IN (${inList})`;
  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE Current_IDNumber <> New_IDNumber 
   OR (Current_IDNumber IS NULL AND New_IDNumber IS NOT NULL);`;
  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE Current_IDNumber <> New_IDNumber 
   OR (Current_IDNumber IS NULL AND New_IDNumber IS NOT NULL);`;
  return { sql, countSql };
}

export function buildPreviewIndividual(byIndividual) {
  const ids = [...byIndividual.keys()].sort((a, b) => a - b);
  if (!ids.length) return { sql: '', countSql: '' };
  const idBranches = [];
  const dobBranches = [];
  for (const iid of ids) {
    const t = byIndividual.get(iid);
    const comment = sqlSafeComment(t.label || `Individual ${iid}`);
    if (t.idNumber) {
      const esc = String(t.idNumber).replace(/'/g, "''");
      idBranches.push(`WHEN i.Id IN (${iid}) THEN '${esc}' -- ${comment}`);
    }
    if (t.dobSql) {
      dobBranches.push(`WHEN i.Id IN (${iid}) THEN '${t.dobSql}' -- ${comment}`);
    }
  }
  const idCase =
    idBranches.length > 0
      ? `CASE
${idBranches.map((b) => '            ' + b).join('\n')}
            ELSE i.IDNumber 
        END`
      : 'i.IDNumber';
  const dobCase =
    dobBranches.length > 0
      ? `CASE
${dobBranches.map((b) => '            ' + b).join('\n')}
            ELSE i.DateOfBirth 
        END`
      : 'i.DateOfBirth';

  const inner = `SELECT 
        i.Id,
        i.IDNumber AS Current_IDNumber,
        ${idCase} AS New_IDNumber,
        i.DateOfBirth AS Current_DOB,
        ${dobCase} AS New_DOB
    FROM members_prod.individual i
    WHERE i.Id IN (${ids.join(',')})`;

  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE 
   (Current_IDNumber <> New_IDNumber OR (Current_IDNumber IS NULL AND New_IDNumber IS NOT NULL))
   OR 
   (Current_DOB <> New_DOB OR (Current_DOB IS NULL AND New_DOB IS NOT NULL));`;

  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE 
   (Current_IDNumber <> New_IDNumber OR (Current_IDNumber IS NULL AND New_IDNumber IS NOT NULL))
   OR 
   (Current_DOB <> New_DOB OR (Current_DOB IS NULL AND New_DOB IS NOT NULL));`;

  return { sql, countSql };
}

export function buildPreviewPolicy(policyToId) {
  if (!policyToId.size) return { sql: '', countSql: '' };
  /** @type {Map<string, Set<string>>} */
  const byNewId = new Map();
  for (const [pol, idNum] of policyToId) {
    const k = String(idNum);
    if (!byNewId.has(k)) byNewId.set(k, new Set());
    byNewId.get(k).add(pol);
  }
  const branches = [...byNewId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([idNum, policies]) => {
      const esc = String(idNum).replace(/'/g, "''");
      const list = [...policies]
        .sort()
        .map((pol) => `'${pol.replace(/'/g, "''")}'`)
        .join(',');
      return `WHEN p.UniquePolicyNumber IN (${list}) THEN '${esc}'`;
    });
  const polList = [...policyToId.keys()]
    .sort()
    .map((pol) => `'${pol.replace(/'/g, "''")}'`)
    .join(',');
  const inner = `SELECT 
        p.UniquePolicyNumber,
        p.IDNumber AS Current_IDNumber,
        CASE
${branches.map((b) => '            ' + b).join('\n')}
            ELSE p.IDNumber 
        END AS New_IDNumber
    FROM policies_prod.policy p
    WHERE p.UniquePolicyNumber IN (${polList})`;
  const sql = `SELECT * FROM (
${inner}
) AS Preview
WHERE Current_IDNumber <> New_IDNumber 
   OR (Current_IDNumber IS NULL AND New_IDNumber IS NOT NULL);`;
  const countSql = `SELECT COUNT(*) AS cnt FROM (
${inner}
) AS Preview
WHERE Current_IDNumber <> New_IDNumber 
   OR (Current_IDNumber IS NULL AND New_IDNumber IS NOT NULL);`;
  return { sql, countSql };
}
