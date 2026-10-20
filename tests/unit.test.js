import test from "node:test";
import assert from "node:assert/strict";
import {
  DB_VERSION,
  initialStores,
  stateOf,
  STORE_NAMES,
  uuid,
  now,
} from "../js/schema.js";
import {
  validateStores,
  validateBackup,
  civilDate,
  safeAdd,
} from "../js/validation.js";
const backup = (stores) => ({
  format: "kakeibo-pwa",
  backupFormatVersion: 1,
  dbSchemaVersion: DB_VERSION,
  createdAt: now(),
  sourceDatasetId: stateOf(stores).datasetId,
  stores,
  recordCounts: Object.fromEntries(
    STORE_NAMES.map((n) => [n, stores[n].length]),
  ),
});
function fixture() {
  const s = initialStores(),
    at = now(),
    v = { revision: 1, createdAt: at, updatedAt: at };
  const policy = uuid(),
    period = uuid(),
    category = uuid();
  s.periodPolicies.push({
    id: policy,
    startDay: 25,
    effectiveFrom: "2026-10-25",
    ...v,
  });
  s.periods.push({
    id: period,
    policyId: policy,
    startDate: "2026-10-25",
    endDate: "2026-11-24",
    labelMonth: "2026-11",
    kind: "normal",
    state: "open",
    sequence: 1,
    ...v,
  });
  s.categories.push({
    id: category,
    type: "expense",
    name: "食費",
    sortOrder: 0,
    active: true,
    ...v,
  });
  s.transactions.push({
    id: uuid(),
    type: "expense",
    date: "2026-11-01",
    periodId: period,
    categoryId: category,
    amount: 1000,
    name: "試験",
    memo: "",
    ...v,
  });
  return s;
}
test("initial schema is valid and contains all 17 stores", () => {
  const s = initialStores();
  assert.equal(STORE_NAMES.length, 17);
  assert.equal(validateStores(s), s);
  validateBackup(backup(s));
});
test("real calendar dates and arithmetic overflow", () => {
  assert(civilDate("2028-02-29"));
  assert(!civilDate("2027-02-29"));
  assert(!civilDate("2026-02-30"));
  assert.throws(() => safeAdd(Number.MAX_SAFE_INTEGER, 1));
});
test("nonempty transaction data round-trips", () =>
  validateBackup(JSON.parse(JSON.stringify(backup(fixture())))));
test("reject duplicate primary and compound keys", () => {
  const s = fixture();
  s.transactions.push({ ...s.transactions[0] });
  assert.throws(() => validateStores(s), /重複/);
  const b = initialStores();
  b.settings.push({ ...b.settings[0] });
  assert.throws(() => validateStores(b), /重複/);
});
test("reject references, periods, money and enum corruption", () => {
  for (const mutate of [
    (s) => (s.transactions[0].categoryId = uuid()),
    (s) => (s.transactions[0].amount = 0),
    (s) => (s.transactions[0].amount = 1.5),
    (s) => (s.transactions[0].amount = 1000000000),
    (s) => (s.transactions[0].type = "transfer"),
    (s) => (s.transactions[0].date = "2026-12-01"),
    (s) => (s.periods[0].labelMonth = "2026-10"),
    (s) => (s.periods[0].endDate = "2026-11-23"),
  ]) {
    const s = fixture();
    mutate(s);
    assert.throws(() => validateStores(s));
  }
});
test("reject missing stores, unknown versions and wrong counts", () => {
  for (const mutate of [
    (b) => delete b.stores.categories,
    (b) => (b.backupFormatVersion = 2),
    (b) => (b.dbSchemaVersion = 99),
    (b) => b.recordCounts.settings++,
    (b) => (b.sourceDatasetId = uuid()),
  ]) {
    const b = backup(initialStores());
    mutate(b);
    assert.throws(() => validateBackup(b));
  }
});
test("reject settlement mismatch and reversal duplication", () => {
  const s = fixture();
  s.periods[0].state = "closed";
  assert.throws(() => validateStores(s), /精算/);
});
test("reject dangling goal notification and invalid settings", () => {
  const s = initialStores();
  s.goalNotifications.push({
    goalRevisionId: uuid(),
    periodId: uuid(),
    firstReachedAt: now(),
  });
  assert.throws(() => validateStores(s));
  for (const value of [0, 100, 1.5]) {
    const p = initialStores();
    p.settings[0].value.warningPercent = value;
    assert.throws(() => validateStores(p));
  }
});
