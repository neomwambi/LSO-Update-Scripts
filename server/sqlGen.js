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
  const both = new Set();
  for (const id of dobIds) {
    if (idIds.has(id)) both.add(id);
  }
  const dobOnly = new Set();
  for (const id of dobIds) {
    if (!both.has(id)) dobOnly.add(id);
  }
  const idOnly = new Set();
  for (const id of idIds) {
    if (!both.has(id)) idOnly.add(id);
  }
  return { dobOnly, idOnly, both };
}

/**
 * @param {Map<number, { idNumber: string|null, dobSql: string|null, label?: string }>} byIndividual
 */
export function classifyIndividualIds(byIndividual) {
  const both = new Set();
  const idOnly = new Set();
  const dobOnly = new Set();
  for (const [iid, t] of byIndividual) {
    const hi = Boolean(t.idNumber);
    const hd = Boolean(t.dobSql);
    if (hi && hd) both.add(iid);
    else if (hi) idOnly.add(iid);
    else if (hd) dobOnly.add(iid);
  }
  return { dobOnly, idOnly, both };
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

  const sql = `UPDATE policies_prod.policyroleplayer prp
SET prp.SearchMetaInfo =
CASE
${branches.join('\n')}
ELSE prp.SearchMetaInfo END
WHERE prp.Id IN (${formatInList(union)});`;

  return { sql, affectedIds: union };
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
  const sql = `UPDATE members_prod.individual i
SET i.SearchMetaInfo =
CASE
${branches.join('\n')}
ELSE i.SearchMetaInfo END
WHERE i.Id IN (${idsList});`;

  return { sql, affectedIds: union };
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
  const sql = `UPDATE policies_prod.policy p
SET p.SearchMetaInfo = ${msg}
WHERE p.UniquePolicyNumber IN (${polList});`;
  return { sql, policies: new Set(policyToId.keys()) };
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
  const sql = `UPDATE policies_prod.policyroleplayer prp
SET prp.DateOfBirth =
CASE
${branches.join('\n')}
ELSE prp.DateOfBirth END
WHERE prp.Id IN (${formatInList(allIds)});`;
  return { sql, affectedIds: allIds };
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
  const sql = `UPDATE policies_prod.policyroleplayer prp
SET prp.IDNumber =
CASE
${branches.join('\n')}
ELSE prp.IDNumber END
WHERE prp.Id IN (${formatInList(allIds)});`;
  return { sql, affectedIds: allIds };
}

/**
 * @param {Map<number, { idNumber: string|null, dobSql: string|null, label?: string }>} byIndividual
 */
export function buildIndividualUpdate(byIndividual) {
  const ids = [...byIndividual.keys()].sort((a, b) => a - b);
  if (!ids.length) return { sql: '', affectedIds: new Set() };

  const idBranches = [];
  const dobBranches = [];
  const needId = ids.some((i) => byIndividual.get(i).idNumber);
  const needDob = ids.some((i) => byIndividual.get(i).dobSql);

  for (const iid of ids) {
    const t = byIndividual.get(iid);
    const comment = sqlSafeComment(t.label || `Individual ${iid}`);
    if (needId) {
      if (t.idNumber) {
        const esc = String(t.idNumber).replace(/'/g, "''");
        idBranches.push(`WHEN i.Id IN (${iid}) THEN '${esc}' -- ${comment}`);
      }
    }
    if (needDob) {
      if (t.dobSql) {
        dobBranches.push(`WHEN i.Id IN (${iid}) THEN '${t.dobSql}' -- ${comment}`);
      }
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

  const sql = `UPDATE members_prod.individual i
SET
  i.IDNumber = ${idCase},
  i.DateOfBirth = ${dobCase}
WHERE i.Id IN (${ids.join(',')});`;

  return { sql, affectedIds: new Set(ids) };
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
  const sql = `UPDATE policies_prod.policy p
SET p.IDNumber =
CASE
${branches.join('\n')}
ELSE p.IDNumber END
WHERE p.UniquePolicyNumber IN (${polList});`;
  return { sql, policies: new Set(policyToId.keys()) };
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
