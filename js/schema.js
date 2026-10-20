export const DB_NAME = "kakeibo-pwa";
export const DB_VERSION = 2;
export const APP_VERSION = "0.4.2-dev";
export const STORES = {
  meta: { key: "key" },
  categories: { key: "id", indexes: { typeOrder: ["type", "sortOrder"] } },
  transactions: {
    key: "id",
    indexes: {
      date: "date",
      periodDate: ["periodId", "date"],
      categoryDate: ["categoryId", "date"],
      occurrenceId: { key: "occurrenceId", unique: true },
    },
  },
  periodPolicies: {
    key: "id",
    indexes: { effectiveFrom: { key: "effectiveFrom", unique: true } },
  },
  periods: {
    key: "id",
    indexes: {
      startDate: { key: "startDate", unique: true },
      sequence: { key: "sequence", unique: true },
      labelMonth: "labelMonth",
    },
  },
  periodBudgets: { key: "periodId" },
  categoryBudgets: {
    key: ["periodId", "categoryId"],
    indexes: { periodId: "periodId" },
  },
  budgetRevisions: {
    key: "id",
    indexes: { periodId: "periodId", operationId: "operationId" },
  },
  recurringRules: { key: "id" },
  recurringOccurrences: {
    key: ["ruleId", "scheduleMonth"],
    indexes: {
      id: { key: "id", unique: true },
      scheduledDate: "scheduledDate",
      transactionId: { key: "transactionId", unique: true },
    },
  },
  carryoverEntries: {
    key: "id",
    indexes: {
      periodSequence: ["periodId", "sequence"],
      sequence: { key: "sequence", unique: true },
      operationId: "operationId",
      reversalOf: { key: "reversalOf", unique: true },
    },
  },
  periodClosings: { key: "periodId" },
  closingRevisions: {
    key: "id",
    indexes: { periodId: "periodId", operationId: "operationId" },
  },
  goalHistory: {
    key: "id",
    indexes: {
      effectivePeriodSequence: ["effectivePeriodId", "sequence"],
      sequence: { key: "sequence", unique: true },
    },
  },
  goalNotifications: { key: "goalRevisionId" },
  operationReceipts: { key: "id" },
  settings: { key: "key" },
};
export const STORE_NAMES = Object.keys(STORES);
export const uuid = () => globalThis.crypto.randomUUID();
export const now = () => new Date().toISOString();
export function emptyStores() {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, []]));
}
export function initialStores() {
  const stores = emptyStores();
  stores.meta = [
    { key: "schemaInfo", value: { dbSchemaVersion: DB_VERSION } },
    { key: "state", datasetId: uuid(), datasetRevision: 0, ledgerSequence: 1 },
  ];
  const at = now(),
    operationId = uuid();
  stores.carryoverEntries.push({
    id: uuid(),
    kind: "opening",
    delta: 0,
    operationId,
    sequence: 1,
    createdAt: at,
  });
  stores.operationReceipts.push({
    id: operationId,
    command: "initialize",
    payloadFingerprint: "{}",
    resultIds: [],
    committedAt: at,
  });
  stores.settings.push({
    key: "preferences",
    value: { startDay: 1, warningPercent: 80 },
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  return stores;
}
export const stateOf = (stores) =>
  stores.meta.find((row) => row.key === "state");
