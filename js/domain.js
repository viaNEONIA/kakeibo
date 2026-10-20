import { isChild } from "./share-state.js";
import { uuid, now, stateOf } from "./schema.js";
import { assert, civilDate, safeAdd } from "./validation.js";
export const yen = (value) =>
  new Intl.NumberFormat("ja-JP").format(value) + "円";
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function plusDays(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function periodBounds(date, startDay = 1) {
  assert(
    civilDate(date) &&
      Number.isInteger(startDay) &&
      startDay >= 1 &&
      startDay <= 28,
    "日付または期間設定が不正です",
  );
  const d = new Date(date + "T00:00:00Z"),
    y = d.getUTCFullYear(),
    m = d.getUTCMonth();
  const start = new Date(0);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCFullYear(y, m - (d.getUTCDate() < startDay ? 1 : 0), startDay);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const startDate = start.toISOString().slice(0, 10),
    endDate = plusDays(next.toISOString().slice(0, 10), -1);
  assert(
    civilDate(startDate) && civilDate(endDate),
    "対応する日付範囲を超えています",
  );
  return { startDate, endDate, labelMonth: endDate.slice(0, 7) };
}
const stamps = () => {
  const at = now();
  return { revision: 1, createdAt: at, updatedAt: at };
};
function touch(row) {
  row.revision = safeAdd(row.revision, 1);
  row.updatedAt = now();
}
export function ensurePeriod(s, date) {
  assert(civilDate(date), "日付を確認してください");
  let found = s.periods.find((p) => p.startDate <= date && date <= p.endDate);
  if (found) return found;
  if (!s.periodPolicies.length) {
    const b = periodBounds(
      date,
      s.settings.find((r) => r.key === "preferences").value.startDay,
    );
    s.periodPolicies.push({
      id: uuid(),
      startDay: s.settings.find((r) => r.key === "preferences").value.startDay,
      effectiveFrom: b.startDate,
      ...stamps(),
    });
  }
  const policies = [...s.periodPolicies].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  const policyFor = (d) =>
    policies.filter((p) => p.effectiveFrom <= d).at(-1) || policies[0];
  function append(start, end, policy, normalBounds) {
    const p = {
      id: uuid(),
      startDate: start,
      endDate: end,
      labelMonth: end.slice(0, 7),
      kind:
        start === normalBounds.startDate && end === normalBounds.endDate
          ? "normal"
          : "transition",
      policyId: policy.id,
      state: "open",
      sequence: 1,
      ...stamps(),
    };
    s.periods.push(p);
    return p;
  }
  if (!s.periods.length) {
    const policy = policyFor(date),
      b = periodBounds(date, policy.startDay);
    found = append(b.startDate, b.endDate, policy, b);
  }
  let sorted = s.periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
  assert(
    date < sorted[0].startDate || date > sorted.at(-1).endDate || found,
    "既存期間に空白があります",
  );
  while (date < sorted[0].startDate) {
    assert(s.periods.length < 12000, "集計期間が多すぎます");
    const end = plusDays(sorted[0].startDate, -1),
      policy = policies[0],
      b = periodBounds(end, policy.startDay);
    append(b.startDate, end, policy, b);
    sorted = s.periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  while (date > sorted.at(-1).endDate) {
    assert(s.periods.length < 12000, "集計期間が多すぎます");
    const start = plusDays(sorted.at(-1).endDate, 1),
      policy = policyFor(start),
      b = periodBounds(start, policy.startDay);
    let end = b.endDate;
    const following = policies.find(
      (p) => p.effectiveFrom > start && p.effectiveFrom <= end,
    );
    if (following) end = plusDays(following.effectiveFrom, -1);
    append(start, end, policy, b);
    sorted = s.periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  sorted.forEach((p, i) => {
    if (p.sequence !== i + 1) {
      p.sequence = i + 1;
      touch(p);
    }
  });
  return sorted.find((p) => p.startDate <= date && date <= p.endDate);
}
export function totals(transactions) {
  let income = 0,
    gross = 0,
    refund = 0;
  for (const t of transactions) {
    if (t.type === "income") income = safeAdd(income, t.amount);
    else if (t.type === "refund") refund = safeAdd(refund, t.amount);
    else gross = safeAdd(gross, t.amount);
  }
  const expense = safeAdd(gross, -refund);
  return { income, expense, refund, net: safeAdd(income, -expense) };
}
export function recalculateClosed(
  s,
  operationId,
  reason = "transaction-change",
) {
  if (isChild(s)) return;
  for (const p of [...s.periods].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  )) {
    if (p.state !== "closed") continue;
    const closing = s.periodClosings.find((c) => c.periodId === p.id);
    assert(closing, "締め記録が見つかりません");
    const expense = totals(
      s.transactions.filter((t) => t.periodId === p.id),
    ).expense;
    const allocation = s.carryoverEntries
      .filter(
        (e) => e.periodId === p.id && ["allocate", "reverse"].includes(e.kind),
      )
      .reduce((a, e) => safeAdd(a, -e.delta), 0);
    const budget =
      s.periodBudgets.find((b) => b.periodId === p.id)?.baseBudget ?? 0;
    const target = safeAdd(safeAdd(budget, allocation), -expense),
      delta = safeAdd(target, -closing.settlementTotal);
    if (!delta) continue;
    const at = now(),
      next = safeAdd(closing.closeRevision, 1),
      state = stateOf(s);
    state.ledgerSequence = safeAdd(state.ledgerSequence, 1);
    s.carryoverEntries.push({
      id: uuid(),
      periodId: p.id,
      kind: "settle",
      delta,
      operationId,
      sequence: state.ledgerSequence,
      createdAt: at,
    });
    s.closingRevisions.push({
      id: uuid(),
      periodId: p.id,
      previousTotal: closing.settlementTotal,
      newTotal: target,
      delta,
      closeRevision: next,
      reason,
      operationId,
      createdAt: at,
    });
    closing.settlementTotal = target;
    closing.closeRevision = next;
    closing.inputRevision = safeAdd(state.datasetRevision, 1);
    closing.lastOperationId = operationId;
  }
}
function cleanInput(s, input, old) {
  assert(
    ["income", "expense", "refund"].includes(input.type),
    "収支の種類を確認してください",
  );
  assert(
    Number.isSafeInteger(input.amount) &&
      input.amount >= 1 &&
      input.amount <= 999999999,
    "金額は1〜999,999,999円の整数で入力してください",
  );
  assert(civilDate(input.date), "日付を確認してください");
  assert(
    typeof input.name === "string" && typeof input.memo === "string",
    "名称とメモを確認してください",
  );
  const category = s.categories.find((c) => c.id === input.categoryId);
  assert(
    category &&
      category.type === (input.type === "income" ? "income" : "expense"),
    "項目を選んでください",
  );
  assert(
    category.active || old?.categoryId === category.id,
    "無効な項目は新規選択できません",
  );
  const period = ensurePeriod(s, input.date);
  return {
    type: input.type,
    date: input.date,
    periodId: period.id,
    categoryId: category.id,
    amount: input.amount,
    name: input.name.trim(),
    memo: input.memo.trim(),
  };
}
export class Ledger {
  constructor(db) {
    this.db = db;
  }
  add(input, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "add-transaction",
      input,
      (s) => {
        const value = cleanInput(s, input);
        const id = uuid();
        s.transactions.push({ id, ...value, ...stamps() });
        recalculateClosed(s, operationId);
        return [id];
      },
      { operationId, expectedRevision },
    );
  }
  edit(id, input, recordRevision, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "edit-transaction",
      { id, input, recordRevision },
      (s) => {
        const row = s.transactions.find((t) => t.id === id);
        assert(
          row && row.revision === recordRevision,
          "取引が変更されています。読み込み直してください",
        );
        const clean = cleanInput(s, input, row);
        if (row.occurrenceId)
          assert(
            clean.date === row.date && clean.type === row.type,
            "定期取引の種類・日付は変更できません",
          );
        Object.assign(row, clean);
        touch(row);
        recalculateClosed(s, operationId);
        return [id];
      },
      { operationId, expectedRevision },
    );
  }
  remove(id, recordRevision, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "delete-transaction",
      { id, recordRevision },
      (s) => {
        const i = s.transactions.findIndex((t) => t.id === id);
        assert(
          i >= 0 && s.transactions[i].revision === recordRevision,
          "取引が変更されています。読み込み直してください",
        );
        const row = s.transactions[i];
        if (row.occurrenceId) {
          const o = s.recurringOccurrences.find(
            (o) => o.id === row.occurrenceId,
          );
          assert(o, "定期予定が見つかりません");
          o.status = "voided";
          delete o.transactionId;
        }
        s.transactions.splice(i, 1);
        recalculateClosed(s, operationId);
        return [id];
      },
      { operationId, expectedRevision },
    );
  }
  saveCategory(
    { id, type, name, active = true },
    recordRevision,
    expectedRevision,
    operationId = uuid(),
  ) {
    return this.db.command(
      "save-category",
      { id, type, name, active, recordRevision },
      (s) => {
        assert(["income", "expense"].includes(type), "項目の種類が不正です");
        assert(
          typeof name === "string" && name.trim(),
          "項目名を入力してください",
        );
        assert(typeof active === "boolean", "項目状態が不正です");
        if (id) {
          const row = s.categories.find((c) => c.id === id);
          assert(
            row && row.revision === recordRevision,
            "項目が変更されています。読み込み直してください",
          );
          assert(row.type === type, "項目の収支区分は変更できません");
          row.name = name.trim();
          row.active = active;
          touch(row);
          return [id];
        }
        const newId = uuid(),
          group = s.categories.filter((c) => c.type === type);
        const sortOrder = group.reduce(
          (a, c) => Math.max(a, c.sortOrder + 1),
          0,
        );
        assert(
          Number.isSafeInteger(sortOrder),
          "項目の並び順が範囲を超えています",
        );
        s.categories.push({
          id: newId,
          type,
          name: name.trim(),
          active,
          sortOrder,
          ...stamps(),
        });
        return [newId];
      },
      { operationId, expectedRevision },
    );
  }
  reorder(type, ids, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "reorder-categories",
      { type, ids },
      (s) => {
        const group = s.categories.filter((c) => c.type === type);
        assert(
          ids.length === group.length &&
            new Set(ids).size === ids.length &&
            ids.every((id) => group.some((c) => c.id === id)),
          "項目一覧が変更されています",
        );
        ids.forEach((id, index) => {
          const row = group.find((c) => c.id === id);
          row.sortOrder = index;
          touch(row);
        });
        return ids;
      },
      { operationId, expectedRevision },
    );
  }
  saveListView(value, expectedRevision) {
    return this.db.command(
      "save-list-view",
      value,
      (s) => {
        assert(
          ["date-desc", "date-asc", "amount-desc", "amount-asc"].includes(
            value.sort,
          ),
          "並び順が不正です",
        );
        assert(
          typeof value.showDate === "boolean" &&
            typeof value.showCategory === "boolean",
          "表示設定が不正です",
        );
        const row = s.settings.find((r) => r.key === "listView");
        if (row) {
          row.value = value;
          touch(row);
        } else s.settings.push({ key: "listView", value, ...stamps() });
        return [];
      },
      { expectedRevision },
    );
  }
}
export function filteredTransactions(s, filters = {}) {
  const categories = new Map(s.categories.map((c) => [c.id, c]));
  const min =
      filters.min === "" || filters.min === undefined
        ? null
        : Number(filters.min),
    max =
      filters.max === "" || filters.max === undefined
        ? null
        : Number(filters.max);
  assert(
    (min === null || (Number.isSafeInteger(min) && min >= 0)) &&
      (max === null || (Number.isSafeInteger(max) && max >= 0)) &&
      (min === null || max === null || min <= max),
    "金額の絞り込み範囲を確認してください",
  );
  const query = (filters.query || "").trim().toLocaleLowerCase("ja");
  const result = s.transactions.filter(
    (t) =>
      (!filters.type || t.type === filters.type) &&
      (!filters.categoryId || t.categoryId === filters.categoryId) &&
      (!filters.from || t.date >= filters.from) &&
      (!filters.to || t.date <= filters.to) &&
      (min === null || t.amount >= min) &&
      (max === null || t.amount <= max) &&
      (!filters.recurring || !!t.occurrenceId) &&
      (!query ||
        [t.name, t.memo, categories.get(t.categoryId)?.name || ""]
          .join(" ")
          .toLocaleLowerCase("ja")
          .includes(query)),
  );
  const sort = filters.sort || "date-desc";
  const factor = sort.endsWith("asc") ? 1 : -1;
  return result.sort(
    (a, b) =>
      factor *
        (sort.startsWith("amount")
          ? a.amount - b.amount
          : a.date.localeCompare(b.date)) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
