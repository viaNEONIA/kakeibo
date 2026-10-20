import { uuid, now, stateOf } from "./schema.js";
import { assert, safeAdd } from "./validation.js";
import {
  ensurePeriod,
  periodBounds,
  plusDays,
  totals,
  recalculateClosed,
} from "./domain.js";
const stamps = () => {
  const at = now();
  return { revision: 1, createdAt: at, updatedAt: at };
};
const integerMoney = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const sum = (rows) => rows.reduce((n, x) => safeAdd(n, x), 0);
export const sortedPeriods = (s) =>
  [...s.periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
export const poolBalance = (s) => sum(s.carryoverEntries.map((e) => e.delta));
export function periodFigures(s, periodId) {
  const p = s.periods.find((p) => p.id === periodId);
  assert(p, "期間が見つかりません");
  const tx = s.transactions.filter((t) => t.periodId === periodId),
    t = totals(tx);
  const entries = s.carryoverEntries.filter((e) => e.periodId === periodId);
  const allocation =
    0 -
    sum(
      entries
        .filter((e) => ["allocate", "reverse"].includes(e.kind))
        .map((e) => e.delta),
    );
  const base =
    s.periodBudgets.find((b) => b.periodId === periodId)?.baseBudget ?? 0;
  const available = safeAdd(base, allocation),
    remaining = safeAdd(available, -t.expense),
    distributed = sum(
      s.categoryBudgets
        .filter((b) => b.periodId === periodId)
        .map((b) => b.amount),
    );
  const balance = poolBalance(s),
    settled =
      s.periodClosings.find((c) => c.periodId === periodId)?.settlementTotal ??
      0;
  const warningPercent = s.settings.find((r) => r.key === "preferences").value
    .warningPercent;
  function warning(expense, budget) {
    if (budget === 0) return expense > 0 ? "未予算支出" : "未使用";
    if (expense > budget) return "超過";
    if (expense === budget) return "使い切り";
    if ((expense / budget) * 100 >= warningPercent) return "注意";
    return "通常";
  }
  const ids = new Set([
    ...s.categories
      .filter((c) => c.type === "expense" && c.active)
      .map((c) => c.id),
    ...s.categoryBudgets
      .filter((b) => b.periodId === periodId)
      .map((b) => b.categoryId),
    ...tx.filter((t) => t.type !== "income").map((t) => t.categoryId),
  ]);
  const categoryRows = [...ids]
    .map((id) => {
      const c = s.categories.find((c) => c.id === id),
        budget =
          s.categoryBudgets.find(
            (b) => b.periodId === periodId && b.categoryId === id,
          )?.amount ?? 0,
        expense = totals(tx.filter((t) => t.categoryId === id)).expense;
      return {
        id,
        name: c.name,
        active: c.active,
        sortOrder: c.sortOrder,
        budget,
        expense,
        remaining: safeAdd(budget, -expense),
        warning: warning(expense, budget),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return {
    period: p,
    ...t,
    base,
    allocation,
    available,
    remaining,
    distributed,
    unassigned: safeAdd(available, -distributed),
    balance,
    allocatable: Math.max(balance, 0),
    unsettled: Math.max(-balance, 0),
    settlement: remaining,
    settled,
    settlementDifference: safeAdd(remaining, -settled),
    projectedBalance: safeAdd(balance, safeAdd(remaining, -settled)),
    usage: available > 0 ? (t.expense / available) * 100 : null,
    warning: warning(t.expense, available),
    categoryRows,
  };
}
export function poolHistory(s) {
  let running = sum(
    s.carryoverEntries.filter((e) => e.kind === "opening").map((e) => e.delta),
  );
  return sortedPeriods(s).map((p) => {
    const f = periodFigures(s, p.id),
      adjustment = sum(
        s.carryoverEntries
          .filter((e) => e.periodId === p.id && e.kind === "adjust")
          .map((e) => e.delta),
      ),
      start = running;
    running = safeAdd(
      safeAdd(running, -f.allocation),
      safeAdd(f.settled, adjustment),
    );
    return {
      period: p,
      start,
      addition: Math.max(f.settled, 0),
      overspend: Math.max(-f.settled, 0),
      allocation: f.allocation,
      adjustment,
      end: running,
      unsettled: Math.max(-running, 0),
    };
  });
}
function period(s, id) {
  const p = s.periods.find((p) => p.id === id);
  assert(p, "期間が見つかりません");
  return p;
}
function entry(s, periodId, kind, delta, operationId, extra = {}) {
  const state = stateOf(s);
  state.ledgerSequence = safeAdd(state.ledgerSequence, 1);
  const id = uuid();
  s.carryoverEntries.push({
    id,
    periodId,
    kind,
    delta,
    operationId,
    sequence: state.ledgerSequence,
    createdAt: now(),
    ...extra,
  });
  return id;
}
function budgetSnapshot(s, id) {
  return {
    baseBudget: s.periodBudgets.find((b) => b.periodId === id)?.baseBudget ?? 0,
    categoryBudgets: s.categoryBudgets
      .filter((b) => b.periodId === id)
      .map((b) => ({ categoryId: b.categoryId, amount: b.amount })),
  };
}
function setBudget(s, id, base, rows, operationId, reason) {
  period(s, id);
  assert(integerMoney(base), "基本予算は0円以上の整数で入力してください");
  assert(
    Array.isArray(rows) &&
      new Set(rows.map((r) => r.categoryId)).size === rows.length,
    "項目別予算が重複しています",
  );
  for (const r of rows)
    assert(
      s.categories.some((c) => c.id === r.categoryId && c.type === "expense") &&
        integerMoney(r.amount),
      "項目別予算を確認してください",
    );
  const allocation = periodFigures(s, id).allocation;
  assert(
    sum(rows.map((r) => r.amount)) <= safeAdd(base, allocation),
    "振分合計が利用可能予算を超えています。予算またはプール配分を調整してください",
  );
  const before = budgetSnapshot(s, id),
    old = s.periodBudgets.find((b) => b.periodId === id);
  if (old) {
    old.baseBudget = base;
    old.revision = safeAdd(old.revision, 1);
    old.updatedAt = now();
  } else s.periodBudgets.push({ periodId: id, baseBudget: base, ...stamps() });
  const existing = new Map(
    s.categoryBudgets
      .filter((b) => b.periodId === id)
      .map((b) => [b.categoryId, b]),
  );
  s.categoryBudgets = s.categoryBudgets.filter((b) => b.periodId !== id);
  for (const r of rows) {
    const old = existing.get(r.categoryId);
    s.categoryBudgets.push({
      periodId: id,
      categoryId: r.categoryId,
      amount: r.amount,
      ...(old
        ? {
            revision: safeAdd(old.revision, 1),
            createdAt: old.createdAt,
            updatedAt: now(),
          }
        : stamps()),
    });
  }
  s.budgetRevisions.push({
    id: uuid(),
    periodId: id,
    before,
    after: budgetSnapshot(s, id),
    reason,
    operationId,
    createdAt: now(),
  });
  recalculateClosed(s, operationId, reason);
}
export class BudgetLedger {
  constructor(db) {
    this.db = db;
  }
  select(date, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "ensure-budget-period",
      { date },
      (s) => [ensurePeriod(s, date).id],
      { operationId, expectedRevision },
    );
  }
  save(id, base, rows, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "save-budget",
      { id, base, rows },
      (s) => {
        setBudget(s, id, base, rows, operationId, "budget-edit");
        return [id];
      },
      { operationId, expectedRevision },
    );
  }
  copyPrevious(id, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "copy-budget",
      { id },
      (s) => {
        const all = sortedPeriods(s),
          index = all.findIndex((p) => p.id === id);
        assert(index > 0, "前の集計期間がありません");
        const source = all[index - 1].id;
        assert(
          s.periodBudgets.some((b) => b.periodId === source),
          "前の期間の予算が未設定です",
        );
        const snap = budgetSnapshot(s, source);
        setBudget(
          s,
          id,
          snap.baseBudget,
          snap.categoryBudgets,
          operationId,
          "budget-copy",
        );
        return [id];
      },
      { operationId, expectedRevision },
    );
  }
  setOpening(amount, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "set-opening-pool",
      { amount },
      (s) => {
        assert(
          integerMoney(amount),
          "初期残高は0円以上の整数で入力してください",
        );
        assert(
          s.carryoverEntries.length === 1 && !s.periodClosings.length,
          "プールの利用開始後は初期残高を変更できません。調整を使用してください",
        );
        const opening = s.carryoverEntries[0];
        opening.delta = amount;
        opening.operationId = operationId;
        opening.createdAt = now();
        return [opening.id];
      },
      { operationId, expectedRevision },
    );
  }
  allocate(id, amount, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "allocate-pool",
      { id, amount },
      (s) => {
        period(s, id);
        assert(
          integerMoney(amount, 1),
          "配分額は1円以上の整数で入力してください",
        );
        const balance = poolBalance(s);
        assert(balance >= 0, "未精算額があるため新規配分は停止しています");
        assert(amount <= balance, "配分可能額が不足しています");
        const result = entry(s, id, "allocate", -amount, operationId);
        recalculateClosed(s, operationId, "allocation");
        return [result];
      },
      { operationId, expectedRevision },
    );
  }
  cancelAllocation(entryId, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "cancel-allocation",
      { entryId },
      (s) => {
        const target = s.carryoverEntries.find((e) => e.id === entryId);
        assert(target?.kind === "allocate", "配分記録が見つかりません");
        assert(
          !s.carryoverEntries.some((e) => e.reversalOf === entryId),
          "この配分は取消済みです",
        );
        const result = entry(
          s,
          target.periodId,
          "reverse",
          -target.delta,
          operationId,
          { reversalOf: entryId },
        );
        recalculateClosed(s, operationId, "allocation-cancel");
        return [result];
      },
      { operationId, expectedRevision },
    );
  }
  adjust(id, delta, memo, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "adjust-pool",
      { id, delta, memo },
      (s) => {
        period(s, id);
        assert(
          Number.isSafeInteger(delta) && delta !== 0,
          "調整額は0以外の整数で入力してください",
        );
        assert(typeof memo === "string", "調整メモを確認してください");
        return [
          entry(s, id, "adjust", delta, operationId, { memo: memo.trim() }),
        ];
      },
      { operationId, expectedRevision },
    );
  }
  close(id, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "close-period",
      { id },
      (s) => {
        const p = period(s, id);
        if (p.state === "closed") {
          recalculateClosed(s, operationId, "manual-reclose");
          return [id];
        }
        const f = periodFigures(s, id),
          at = now();
        p.state = "closed";
        p.revision = safeAdd(p.revision, 1);
        p.updatedAt = at;
        if (f.settlement !== 0)
          entry(s, id, "settle", f.settlement, operationId);
        s.periodClosings.push({
          periodId: id,
          inputRevision: safeAdd(stateOf(s).datasetRevision, 1),
          settlementTotal: f.settlement,
          closeRevision: 1,
          lastOperationId: operationId,
        });
        s.closingRevisions.push({
          id: uuid(),
          periodId: id,
          previousTotal: 0,
          newTotal: f.settlement,
          delta: f.settlement,
          closeRevision: 1,
          reason: "manual-close",
          operationId,
          createdAt: at,
        });
        return [id];
      },
      { operationId, expectedRevision },
    );
  }
  changePeriodStart(afterId, startDay, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "change-period-start",
      { afterId, startDay },
      (s) => {
        assert(
          Number.isInteger(startDay) && startDay >= 1 && startDay <= 28,
          "開始日は1〜28日を指定してください",
        );
        const all = sortedPeriods(s),
          last = all.at(-1);
        assert(
          last && last.id === afterId,
          "保存済みの最後の期間を選んでください。既存期間は変更しません",
        );
        assert(last.state === "closed", "適用元の期間を先に締めてください");
        const currentPolicy = s.periodPolicies.find(
          (p) => p.id === last.policyId,
        );
        assert(
          currentPolicy.startDay !== startDay,
          "同じ開始日が設定されています",
        );
        const effectiveFrom = plusDays(last.endDate, 1);
        assert(
          !s.periodPolicies.some((p) => p.effectiveFrom === effectiveFrom),
          "この日付の設定が既にあります",
        );
        const policy = { id: uuid(), startDay, effectiveFrom, ...stamps() };
        s.periodPolicies.push(policy);
        const bounds = periodBounds(effectiveFrom, startDay);
        let normalStart = effectiveFrom;
        if (bounds.startDate !== effectiveFrom) {
          const next = plusDays(bounds.endDate, 1);
          s.periods.push({
            id: uuid(),
            startDate: effectiveFrom,
            endDate: bounds.endDate,
            labelMonth: bounds.endDate.slice(0, 7),
            kind: "transition",
            policyId: policy.id,
            state: "open",
            sequence: all.length + 1,
            ...stamps(),
          });
          normalStart = next;
        }
        ensurePeriod(s, normalStart);
        const pref = s.settings.find((r) => r.key === "preferences");
        pref.value.startDay = startDay;
        pref.revision = safeAdd(pref.revision, 1);
        pref.updatedAt = now();
        return [policy.id];
      },
      { operationId, expectedRevision },
    );
  }
}
