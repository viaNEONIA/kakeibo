import { Recurring, recurringMonth, validMonth } from "./recurring.js";
import { stateOf } from "./schema.js";
import { isChild } from "./share-state.js";
import { today, yen } from "./domain.js";
const $ = (id) => document.getElementById(id);
const node = (tag, text) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
export function createRecurringUI({ getState, run, refresh, notify }) {
  let snapshot = null,
    dirty = false,
    editing = null,
    ready = false;
  const service = () => new Recurring(getState().db);
  function categories() {
    if (!snapshot) return;
    const selected = $("recurring-category").value;
    $("recurring-category").replaceChildren(
      ...snapshot.categories
        .filter(
          (c) =>
            c.type === $("recurring-type").value &&
            (c.active || c.id === editing?.categoryId),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => {
          const o = node("option", c.name + (c.active ? "" : "（無効）"));
          o.value = c.id;
          return o;
        }),
    );
    if (
      snapshot.categories.some(
        (c) => c.id === selected && c.type === $("recurring-type").value,
      )
    )
      $("recurring-category").value = selected;
  }
  function reset() {
    dirty = false;
    editing = null;
    $("recurring-form").reset();
    $("recurring-start").value = today().slice(0, 7);
    $("recurring-form-title").textContent = "定期収支を追加";
    categories();
  }
  $("recurring-month").value = today().slice(0, 7);
  reset();
  $("recurring-form").addEventListener("input", () => (dirty = true));
  $("recurring-type").addEventListener("change", categories);
  $("recurring-cancel").addEventListener("click", reset);
  $("recurring-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await service().save(
        {
          id: editing?.id,
          type: $("recurring-type").value,
          name: $("recurring-name").value,
          amount: Number($("recurring-amount").value),
          categoryId: $("recurring-category").value,
          dayOfMonth: Number($("recurring-day").value),
          activeFrom: $("recurring-start").value,
          activeUntil: $("recurring-end").value || null,
          enabled: $("recurring-enabled").checked,
        },
        editing?.revision,
        stateOf(getState().current).datasetRevision,
      );
      reset();
      await refresh();
      notify(
        "定期設定を保存しました。予定は手動確定するまで実績に含みません。",
      );
    });
  });
  function confirmRow(o) {
    if (
      !confirm(
        `${o.scheduledDate} ${o.snapshot.type === "income" ? "収入" : "支出"} ${o.snapshot.name} ${yen(o.snapshot.amount)}を実績として確定しますか？`,
      )
    )
      return;
    run(async () => {
      await service().confirm(
        o.ruleId,
        o.scheduleMonth,
        stateOf(getState().current).datasetRevision,
      );
      await refresh();
      notify("定期予定を実績として確定しました。");
    });
  }
  function rows() {
    if (!snapshot) return;
    const child = isChild(snapshot),
      month = $("recurring-month").value;
    $("recurring-schedule").replaceChildren();
    if (validMonth(month))
      for (const o of recurringMonth(snapshot, month)) {
        const p = node(
          "p",
          `${o.scheduledDate} ／ ${o.snapshot.type === "income" ? "収入" : "支出"} ／ ${o.snapshot.name} ／ ${yen(o.snapshot.amount)} ／ ${o.status === "confirmed" ? "確定済み" : o.status === "voided" ? "削除済み（自動再登録なし）" : o.eligible ? "未確定" : "停止中"}`,
        );
        if (o.status === "pending" && o.eligible && !child) {
          const b = node("button", "この予定を確定");
          b.type = "button";
          b.dataset.recurringConfirm = o.ruleId;
          b.disabled = !ready;
          b.addEventListener("click", () => confirmRow(o));
          p.append(b);
        }
        $("recurring-schedule").append(p);
      }
    if (!$("recurring-schedule").childElementCount)
      $("recurring-schedule").append(
        node(
          "p",
          validMonth(month)
            ? "この月の予定はありません。"
            : "予定月を選んでください。",
        ),
      );
    $("recurring-rules").replaceChildren(
      ...snapshot.recurringRules.map((r) => {
        const p = node(
          "p",
          `${r.type === "income" ? "収入" : "支出"} ／ ${r.name} ／ ${yen(r.amount)} ／ 毎月${r.dayOfMonth}日 ／ ${r.activeFrom}〜${r.activeUntil || "終了なし"} ／ ${r.enabled ? "有効" : "無効"}`,
        );
        if (!child) {
          const b = node("button", "設定を編集");
          b.type = "button";
          b.dataset.recurringEdit = r.id;
          b.disabled = !ready;
          b.addEventListener("click", () => {
            if (dirty && !confirm("未保存の定期設定を破棄して編集しますか？"))
              return;
            editing = structuredClone(r);
            dirty = false;
            $("recurring-type").value = r.type;
            categories();
            $("recurring-category").value = r.categoryId;
            $("recurring-name").value = r.name;
            $("recurring-amount").value = r.amount;
            $("recurring-day").value = r.dayOfMonth;
            $("recurring-start").value = r.activeFrom;
            $("recurring-end").value = r.activeUntil || "";
            $("recurring-enabled").checked = r.enabled;
            $("recurring-form-title").textContent = "定期収支を編集";
            $("recurring-form").scrollIntoView({ block: "center" });
          });
          p.append(b);
        }
        return p;
      }),
    );
    const d = new Date(today().slice(0, 7) + "-01T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + 1);
    const upcoming = [
      ...recurringMonth(snapshot, today().slice(0, 7)),
      ...recurringMonth(snapshot, d.toISOString().slice(0, 7)),
    ]
      .filter((o) => o.status === "pending" && o.eligible)
      .slice(0, 8);
    $("home-recurring").replaceChildren(
      ...upcoming.map((o) =>
        node(
          "p",
          `${o.scheduledDate}${o.scheduledDate < today() ? " 期限経過" : ""} ／ ${o.snapshot.type === "income" ? "収入" : "支出"} ${o.snapshot.name} ${yen(o.snapshot.amount)}（未確定）`,
        ),
      ),
    );
    if (!upcoming.length)
      $("home-recurring").append(
        node("p", "今月・翌月の未確定予定はありません。"),
      );
  }
  $("recurring-month").addEventListener("change", rows);
  function syncEnabled(enabled) {
    ready = enabled;
    const child = snapshot && isChild(snapshot);
    for (const e of $("recurring-form").querySelectorAll("input,select,button"))
      e.disabled = !enabled || !!child;
    for (const e of document.querySelectorAll(
      "[data-recurring-confirm],[data-recurring-edit]",
    ))
      e.disabled = !enabled || !!child;
  }
  return {
    render(s, enabled) {
      snapshot = s;
      ready = enabled;
      if (!dirty) categories();
      $("recurring-form").hidden = isChild(s);
      $("recurring-permission").textContent = isChild(s)
        ? "定期設定・手動確定は親端末で行ってください。表示は親から受け取った内容です。"
        : "毎月の暦日で予定を作ります。短い月の29〜31日は月末へ補正します。";
      rows();
      syncEnabled(enabled);
    },
    syncEnabled,
    dirty: () => dirty,
    reset,
  };
}
