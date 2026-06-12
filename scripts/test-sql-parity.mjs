/**
 * Smoke test: every UPDATE script includes the same "would change" filter as its preview.
 */
import {
  buildPolicyRolePlayerDobUpdate,
  buildPolicyRolePlayerIdUpdate,
  buildIndividualUpdate,
  buildPolicyIdUpdate,
  buildPolicyRolePlayerSearchMetaUpdate,
  buildIndividualSearchMetaUpdate,
  buildPolicySearchMetaUpdate,
  classifyPolicyRolePlayerIds,
  classifyIndividualIds,
  classifyFromChangingIdSets,
} from '../server/sqlGen.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rpDob = new Map([['2000-01-15', { ids: new Set([1, 2]), label: 'Test A' }]]);
const rpId = new Map([['9001011234567', { ids: new Set([2, 3]), label: 'Test B' }]]);
const individual = new Map([
  [10, { idNumber: '9001011234567', dobSql: '2000-01-15', label: 'Test C' }],
]);
const policy = new Map([['POL001', '9001011234567']]);

const prpClass = classifyPolicyRolePlayerIds(rpDob, rpId);
const indClass = classifyIndividualIds(individual);

const updates = [
  buildPolicyRolePlayerDobUpdate(rpDob),
  buildPolicyRolePlayerIdUpdate(rpId),
  buildIndividualUpdate(individual),
  buildPolicyIdUpdate(policy),
  buildPolicyRolePlayerSearchMetaUpdate(prpClass),
  buildIndividualSearchMetaUpdate(indClass),
  buildPolicySearchMetaUpdate(policy),
];

for (const [i, u] of updates.entries()) {
  assert(u.sql.includes(' AND '), `Update ${i + 1} must filter to rows that would change`);
  assert(u.countSql?.includes('COUNT(*)'), `Update ${i + 1} must expose countSql for parity checks`);
}

const prpDobUp = buildPolicyRolePlayerDobUpdate(rpDob);
const prpIdUp = buildPolicyRolePlayerIdUpdate(rpId);
assert(prpDobUp.changingIdsSql?.includes('SELECT prp.Id'), 'DOB update must expose changingIdsSql');
assert(prpIdUp.changingIdsSql?.includes('SELECT prp.Id'), 'ID update must expose changingIdsSql');

const fromSets = classifyFromChangingIdSets(new Set([1]), new Set([1, 2]));
assert(fromSets.both.has(1) && fromSets.idOnly.has(2), 'classifyFromChangingIdSets must split sets');

console.log('OK: all UPDATE scripts include change filters, countSql, and SearchMetaInfo scoping helpers.');
