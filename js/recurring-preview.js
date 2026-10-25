import { recurringMonth } from "./recurring.js";
import { isChild, sharing } from "./share-state.js";
import { safeAdd } from "./validation.js";
// Read-only: never creates periods, occurrences, actuals, settlements or receipts.
export function recurringPreview(s, periodId) {
  const period = s.periods.find((p) => p.id === periodId);
  if (!period) return null;
  const source = isChild(s) ? sharing(s).master : s;
  const categories = new Map(source.categories.map((c) => [c.id, c]));
  const rows = [];
  let month = period.startDate.slice(0, 7),
    last = period.endDate.slice(0, 7);
  while (month <= last) {
    rows.push(
      ...recurringMonth(source, month).filter(
        (o) =>
          o.status === "pending" &&
          o.eligible &&
          o.scheduledDate >= period.startDate &&
          o.scheduledDate <= period.endDate &&
          categories.get(o.snapshot.categoryId)?.active,
      ),
    );
    if (month === last) break;
    const d = new Date(month + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 1);
    month = d.toISOString().slice(0, 7);
  }
  const byCategory = {};
  let income = 0,
    expense = 0;
  for (const o of rows) {
    const id = o.snapshot.categoryId;
    byCategory[id] = safeAdd(byCategory[id] || 0, o.snapshot.amount);
    if (o.snapshot.type === "income")
      income = safeAdd(income, o.snapshot.amount);
    else expense = safeAdd(expense, o.snapshot.amount);
  }
  return { income, expense, byCategory, rows, parentSnapshot: isChild(s) };
}
