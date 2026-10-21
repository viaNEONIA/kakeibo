import { uuid, now } from "./schema.js";
import { assert, safeAdd } from "./validation.js";
import { cleanInput, recalculateClosed } from "./domain.js";
export const validMonth = (m) =>
  typeof m === "string" &&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(m) &&
  Number(m.slice(0, 4)) >= 1;
export function scheduledDate(month, day) {
  assert(
    validMonth(month) && Number.isInteger(day) && day >= 1 && day <= 31,
    "予定月・定期日を確認してください",
  );
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return month + "-" + String(Math.min(day, d.getUTCDate())).padStart(2, "0");
}
const snap = (r) => ({
  type: r.type,
  name: r.name,
  amount: r.amount,
  categoryId: r.categoryId,
  dayOfMonth: r.dayOfMonth,
});
const active = (r, m) =>
  r.enabled && r.activeFrom <= m && (!r.activeUntil || m <= r.activeUntil);
export function recurringMonth(s, month) {
  assert(validMonth(month), "予定月を選んでください");
  const rows = s.recurringOccurrences
    .filter((o) => o.scheduleMonth === month)
    .map((o) => ({
      ...structuredClone(o),
      eligible: active(
        s.recurringRules.find((r) => r.id === o.ruleId),
        month,
      ),
    }));
  for (const rule of s.recurringRules)
    if (active(rule, month) && !rows.some((o) => o.ruleId === rule.id))
      rows.push({
        ruleId: rule.id,
        scheduleMonth: month,
        scheduledDate: scheduledDate(month, rule.dayOfMonth),
        ruleRevision: rule.revision,
        snapshot: snap(rule),
        status: "pending",
        eligible: true,
      });
  return rows.sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
export class Recurring {
  constructor(db) {
    this.db = db;
  }
  save(input, recordRevision, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "save-recurring-rule",
      input,
      (s) => {
        const old = input.id
          ? s.recurringRules.find((r) => r.id === input.id)
          : null;
        if (input.id)
          assert(
            old && old.revision === recordRevision,
            "定期設定が変更されています。読み込み直してください",
          );
        assert(
          ["income", "expense"].includes(input.type),
          "定期収支の種類を選んでください",
        );
        assert(
          typeof input.name === "string" && input.name.trim(),
          "名称を入力してください",
        );
        assert(
          Number.isSafeInteger(input.amount) &&
            input.amount >= 1 &&
            input.amount <= 999999999,
          "金額は1〜999,999,999円の整数で入力してください",
        );
        assert(
          Number.isInteger(input.dayOfMonth) &&
            input.dayOfMonth >= 1 &&
            input.dayOfMonth <= 31,
          "定期日は1〜31日で入力してください",
        );
        assert(
          validMonth(input.activeFrom) &&
            (input.activeUntil === null ||
              (validMonth(input.activeUntil) &&
                input.activeUntil >= input.activeFrom)),
          "開始月・終了月を確認してください",
        );
        assert(
          typeof input.enabled === "boolean",
          "有効状態を確認してください",
        );
        const c = s.categories.find((c) => c.id === input.categoryId);
        assert(
          c && c.type === input.type && (c.active || old?.categoryId === c.id),
          "有効な収支項目を選んでください",
        );
        const at = now(),
          row = {
            id: old?.id || uuid(),
            type: input.type,
            name: input.name.trim(),
            amount: input.amount,
            categoryId: c.id,
            dayOfMonth: input.dayOfMonth,
            activeFrom: input.activeFrom,
            activeUntil: input.activeUntil,
            enabled: input.enabled,
            revision: old ? safeAdd(old.revision, 1) : 1,
            createdAt: old?.createdAt || at,
            updatedAt: at,
          };
        if (old) Object.assign(old, row);
        else s.recurringRules.push(row);
        return [row.id];
      },
      { expectedRevision, operationId },
    );
  }
  confirm(ruleId, month, expectedRevision, operationId = uuid()) {
    return this.db.command(
      "confirm-recurring",
      { ruleId, month },
      (s) => {
        const row = recurringMonth(s, month).find((o) => o.ruleId === ruleId);
        assert(row, "この月の定期予定がありません");
        if (row.status === "confirmed") return [row.transactionId];
        assert(
          row.status !== "voided",
          "削除済みの定期実績は再確定できません。必要なら通常入力で登録してください",
        );
        assert(row.eligible, "無効または適用期間外の定期予定は確定できません");
        const value = cleanInput(s, {
            ...row.snapshot,
            date: row.scheduledDate,
            memo: "",
          }),
          at = now();
        let o = s.recurringOccurrences.find(
          (o) => o.ruleId === ruleId && o.scheduleMonth === month,
        );
        if (!o) {
          o = {
            id: uuid(),
            ruleId,
            scheduleMonth: month,
            scheduledDate: row.scheduledDate,
            ruleRevision: row.ruleRevision,
            snapshot: structuredClone(row.snapshot),
            status: "pending",
          };
          s.recurringOccurrences.push(o);
        }
        const id = uuid();
        o.status = "confirmed";
        o.transactionId = id;
        s.transactions.push({
          id,
          ...value,
          occurrenceId: o.id,
          revision: 1,
          createdAt: at,
          updatedAt: at,
        });
        recalculateClosed(s, operationId, "confirm-recurring");
        return [id];
      },
      { expectedRevision, operationId },
    );
  }
}
