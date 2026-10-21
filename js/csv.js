import { poolHistory } from "./budget.js";
import { goalAt } from "./goals.js";
import { validateStores } from "./validation.js";
// Always quote text, escape embedded quotes, and neutralize spreadsheet formulas.
export function csvCell(value) {
  if (typeof value === "number") return String(value);
  let s = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]/u.test(s) || /^[\t\r\n]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
const encode = (rows) =>
  "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
export function transactionsCsv(s) {
  validateStores(s);
  const periods = new Map(s.periods.map((p) => [p.id, p])),
    cats = new Map(s.categories.map((c) => [c.id, c.name])),
    occ = new Map(s.recurringOccurrences.map((o) => [o.id, o]));
  return encode([
    [
      "ID",
      "日付",
      "種類",
      "項目",
      "名称",
      "金額",
      "メモ",
      "定期登録元ID",
      "集計期間開始日",
      "集計期間終了日",
    ],
    ...[...s.transactions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((t) => [
        t.id,
        t.date,
        { income: "収入", expense: "支出", refund: "返金" }[t.type],
        cats.get(t.categoryId),
        t.name,
        t.amount,
        t.memo,
        occ.get(t.occurrenceId)?.ruleId || "",
        periods.get(t.periodId).startDate,
        periods.get(t.periodId).endDate,
      ]),
  ]);
}
export function poolCsv(s) {
  validateStores(s);
  return encode([
    [
      "年月",
      "月初残高",
      "追加",
      "配分",
      "超過精算",
      "調整",
      "月末実残高",
      "未精算額",
      "当時の目標額",
      "集計期間開始日",
      "集計期間終了日",
      "期間種別",
    ],
    ...poolHistory(s).map((r) => [
      r.period.labelMonth,
      r.start,
      r.addition,
      r.allocation,
      r.overspend,
      r.adjustment,
      r.end,
      r.unsettled,
      goalAt(s, r.period.id)?.targetAmount ?? "",
      r.period.startDate,
      r.period.endDate,
      r.period.kind === "transition" ? "移行期間" : "通常期間",
    ]),
  ]);
}
