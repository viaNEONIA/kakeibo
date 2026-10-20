import { isChild, sharing } from "./share-state.js";
import { totals } from "./domain.js";
import { periodFigures } from "./budget.js";
import { safeAdd } from "./validation.js";
// This is a read-only view. It never changes settled pool entries or approvals.
export function childBudgetPreview(s, periodId) {
  if (!isChild(s)) return null;
  const q = sharing(s),
    p = s.periods.find((p) => p.id === periodId),
    f = periodFigures(s, periodId);
  const within = (t) => !!t && p.startDate <= t.date && t.date <= p.endDate;
  const parentRows = q.master.transactions.filter(within),
    localRows = s.transactions.filter(within),
    confirmed = totals(parentRows),
    provisional = totals(localRows);
  const unknown = q.confirmedEventIds === undefined,
    known = new Set(q.confirmedEventIds || []),
    unconfirmed = q.events.filter((e) => !known.has(e.id));
  const grouped = new Map();
  for (const e of unconfirmed) {
    if (!grouped.has(e.recordId)) grouped.set(e.recordId, []);
    grouped.get(e.recordId).push(e);
  }
  const localById = new Map(s.transactions.map((t) => [t.id, t])),
    parentById = new Map(q.master.transactions.map((t) => [t.id, t]));
  const pendingIds = [...grouped.keys()].filter(
    (id) =>
      within(localById.get(id)) ||
      within(parentById.get(id)) ||
      grouped.get(id).some((e) => within(e.value)),
  );
  const confirmedRemaining = safeAdd(f.available, -confirmed.expense),
    remaining = f.remaining;
  return {
    unknown,
    pendingCount: unknown ? null : pendingIds.length,
    totalPendingCount: unknown ? null : grouped.size,
    provisional: unknown || pendingIds.length > 0,
    confirmed: { ...confirmed, remaining: confirmedRemaining },
    local: { ...provisional, remaining },
    delta: {
      income: safeAdd(provisional.income, -confirmed.income),
      expense: safeAdd(provisional.expense, -confirmed.expense),
      refund: safeAdd(provisional.refund, -confirmed.refund),
      remaining: safeAdd(remaining, -confirmedRemaining),
    },
    categoryConfirmed: Object.fromEntries(
      f.categoryRows.map((c) => [
        c.id,
        totals(parentRows.filter((t) => t.categoryId === c.id)).expense,
      ]),
    ),
  };
}
