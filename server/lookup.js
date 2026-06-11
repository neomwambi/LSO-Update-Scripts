/**
 * Bulk lookup: role players matching any (policy, benefit name) pair from the workbook.
 * Returns rows: UniquePolicyNumber, FullName, RolePlayerId, IndividualId
 */
export function buildLookupSql(placeholdersNames, placeholdersPolicies) {
  return `
SELECT p.UniquePolicyNumber, CONCAT(prp.FirstName, ' ', prp.Surname) AS FullName, prp.Id AS RolePlayerId, prp.IndividualId
FROM policies_prod.policy p
JOIN policies_prod.policybenefit pb ON pb.Policy = p.Id
JOIN policies_prod.policyroleplayer prp ON prp.PolicyBenefit = pb.Id
WHERE CONCAT(prp.FirstName, ' ', prp.Surname) IN (${placeholdersNames})
AND p.UniquePolicyNumber IN (${placeholdersPolicies})
UNION
SELECT p.UniquePolicyNumber, CONCAT(prp.FirstName, ' ', prp.Surname), prp.Id, prp.IndividualId
FROM policies_prod.policy p
JOIN policies_prod.policyroleplayer prp ON prp.policy = p.Id
WHERE CONCAT(prp.FirstName, ' ', prp.Surname) IN (${placeholdersNames})
AND p.UniquePolicyNumber IN (${placeholdersPolicies})
`.trim();
}

export async function runLookup(pool, uniqueNames, uniquePolicies) {
  if (!uniqueNames.length || !uniquePolicies.length) {
    return [];
  }
  const namePh = uniqueNames.map(() => '?').join(',');
  const polPh = uniquePolicies.map(() => '?').join(',');
  const sql = buildLookupSql(namePh, polPh);
  const params = [...uniqueNames, ...uniquePolicies, ...uniqueNames, ...uniquePolicies];
  const [rows] = await pool.query(sql, params);
  return rows;
}
