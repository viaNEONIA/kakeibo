import {
  BudgetLedger,
  periodFigures,
  poolBalance,
  poolHistory,
  sortedPeriods,
} from "./budget.js";
import { stateOf } from "./schema.js";
import { today, plusDays, periodBounds, yen } from "./domain.js";
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const title = (p) =>
  p.labelMonth + (p.kind === "transition" ? " 移行期間" : "分");
export function createBudgetUI({ getState, run, refresh, notify }) {
  let selected = null,
    ready = false,
    budgetDirty = false,
    poolDirty = false,
    openingDirty = false,
    adjustDirty = false,
    policyDirty = false,
    snapshot = null;
  $("budget-date").value = today();
  for (let day = 1; day <= 28; day++) {
    const option = node("option", day + "日");
    option.value = day;
    $("policy-start-day").append(option);
  }
  const service = () => new BudgetLedger(getState().db),
    rev = () => stateOf(getState().current).datasetRevision;
  const clearDrafts = () => {
    budgetDirty = poolDirty = openingDirty = adjustDirty = policyDirty = false;
  };
  function syncEnabled(enabled) {
    ready = enabled;
    const has = !!snapshot?.periods.some((p) => p.id === selected),
      opening =
        !!snapshot &&
        snapshot.carryoverEntries.length === 1 &&
        !snapshot.periodClosings.length;
    for (const id of ["budget-show", "budget-prev", "budget-next"])
      $(id).disabled = !enabled;
    for (const id of [
      "budget-save",
      "budget-copy",
      "adjust-submit",
      "close-period",
    ])
      $(id).disabled = !enabled || !has;
    $("allocate-submit").disabled =
      !enabled || !has || (snapshot ? poolBalance(snapshot) <= 0 : true);
    $("opening-submit").disabled = !enabled || !has || !opening;
    $("policy-submit").disabled = !enabled || !snapshot?.periods.length;
    for (const b of document.querySelectorAll("[data-cancel-allocation]"))
      b.disabled = !enabled;
  }
  async function openDate(date) {
    if (
      (budgetDirty ||
        poolDirty ||
        openingDirty ||
        adjustDirty ||
        policyDirty) &&
      !confirm("保存していない予算・配分の入力を破棄して期間を切り替えますか？")
    )
      return;
    const existing = getState().current?.periods.find(
      (p) => p.startDate <= date && date <= p.endDate,
    );
    if (existing) {
      selected = existing.id;
      clearDrafts();
      $("budget-date").value = date;
      render(getState().current);
      return;
    }
    await run(async () => {
      const result = await service().select(date, rev());
      selected = result.resultIds[0];
      clearDrafts();
      $("budget-date").value = date;
      await refresh();
      notify("集計期間を準備しました。");
    });
  }
  $("budget-show").addEventListener("click", () =>
    openDate($("budget-date").value),
  );
  $("budget-prev").addEventListener("click", () => {
    const p = snapshot?.periods.find((p) => p.id === selected);
    if (p) openDate(plusDays(p.startDate, -1));
  });
  $("budget-next").addEventListener("click", () => {
    const p = snapshot?.periods.find((p) => p.id === selected);
    if (p) openDate(plusDays(p.endDate, 1));
  });
  function draftTotal() {
    const base = Number($("budget-base").value),
      allocation =
        selected && snapshot ? periodFigures(snapshot, selected).allocation : 0;
    let total = 0;
    for (const input of document.querySelectorAll("[data-category-budget]"))
      total += Number(input.value);
    $("budget-draft-total").textContent =
      "振分合計 " + yen(total) + " ／ 未振分 " + yen(base + allocation - total);
  }
  $("budget-form").addEventListener("input", () => {
    budgetDirty = true;
    draftTotal();
  });
  $("budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const rows = [...document.querySelectorAll("[data-category-budget]")].map(
        (input) => ({
          categoryId: input.dataset.categoryBudget,
          amount: Number(input.value),
        }),
      );
      await service().save(
        selected,
        Number($("budget-base").value),
        rows,
        rev(),
      );
      budgetDirty = false;
      await refresh();
      notify("予算を保存しました。");
    });
  });
  $("budget-copy").addEventListener("click", () => {
    if (
      (budgetDirty ||
        snapshot.periodBudgets.some((b) => b.periodId === selected)) &&
      !confirm(
        "現在の予算を前期間の基本予算・項目別振分で置き換えますか？ 配分・実績はコピーしません。",
      )
    )
      return;
    run(async () => {
      await service().copyPrevious(selected, rev());
      budgetDirty = false;
      await refresh();
      notify("前期間の予算をコピーしました。");
    });
  });
  $("allocate-form").addEventListener("input", () => {
    poolDirty = true;
  });
  $("allocate-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await service().allocate(
        selected,
        Number($("allocate-amount").value),
        rev(),
      );
      poolDirty = false;
      $("allocate-amount").value = "";
      await refresh();
      notify("プールから配分しました。");
    });
  });
  $("opening-form").addEventListener("input", () => {
    openingDirty = true;
  });
  $("opening-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await service().setOpening(Number($("opening-amount").value), rev());
      openingDirty = false;
      await refresh();
      notify("初期残高を保存しました。");
    });
  });
  $("adjust-form").addEventListener("input", () => {
    adjustDirty = true;
  });
  $("adjust-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = Number($("adjust-amount").value);
    if (!confirm("プール残高を " + yen(amount) + " 調整しますか？")) return;
    run(async () => {
      await service().adjust(selected, amount, $("adjust-memo").value, rev());
      adjustDirty = false;
      $("adjust-amount").value = "";
      $("adjust-memo").value = "";
      await refresh();
      notify("残高調整を記録しました。");
    });
  });
  $("close-period").addEventListener("click", () => {
    const f = periodFigures(snapshot, selected);
    if (
      !confirm(
        (budgetDirty
          ? "未保存の予算入力は反映されません。保存済みの値で締めます。 "
          : "") +
          title(f.period) +
          "（" +
          f.period.startDate +
          "〜" +
          f.period.endDate +
          "）の精算差額 " +
          yen(f.settlementDifference) +
          " を反映しますか？" +
          (f.period.endDate >= today() ? " 期間終了前の締めです。" : ""),
      )
    )
      return;
    run(async () => {
      await service().close(selected, rev());
      await refresh();
      notify("期間の精算を確定しました。");
    });
  });
  $("history-range").addEventListener("change", () => renderHistory());
  function renderHistory() {
    if (!snapshot) return;
    const all = poolHistory(snapshot),
      range = $("history-range").value,
      rows = range === "all" ? all : all.slice(-Number(range));
    $("pool-history").replaceChildren(
      ...rows.map((row) => {
        const tr = node("tr");
        for (const value of [
          title(row.period) +
            " " +
            row.period.startDate +
            "〜" +
            row.period.endDate +
            (row.period.state === "open" ? " 未締め" : ""),
          yen(row.start),
          yen(row.addition),
          yen(row.allocation),
          yen(row.overspend),
          yen(row.adjustment),
          yen(row.end),
          yen(row.unsettled),
        ])
          tr.append(node("td", value));
        return tr;
      }),
    );
  }
  function policyPreview() {
    const last = snapshot?.periods.find(
      (p) => p.id === $("policy-after").value,
    );
    if (!last) {
      $("policy-preview").textContent =
        "予算画面で集計期間を準備してください。";
      return;
    }
    const day = Number($("policy-start-day").value),
      start = plusDays(last.endDate, 1),
      b = periodBounds(start, day);
    $("policy-preview").textContent =
      (last.state === "closed" ? "" : "先に適用元の期間を締めてください。 ") +
      (b.startDate === start
        ? "次の通常期間は " + start + "〜" + b.endDate
        : "移行期間 " +
          start +
          "〜" +
          b.endDate +
          " を接続し、その後は毎月" +
          day +
          "日始まりです。移行期間の予算は手動設定です。");
  }
  $("period-policy-form").addEventListener("input", () => {
    policyDirty = true;
    policyPreview();
  });
  $("period-policy-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (
      !confirm(
        $("policy-preview").textContent +
          " 過去の期間と履歴は維持します。変更しますか？",
      )
    )
      return;
    run(async () => {
      await service().changePeriodStart(
        $("policy-after").value,
        Number($("policy-start-day").value),
        rev(),
      );
      policyDirty = false;
      await refresh();
      notify("締め後の集計期間設定を変更しました。");
    });
  });
  function render(s) {
    snapshot = s;
    if (selected && !s.periods.some((p) => p.id === selected)) {
      selected = null;
      clearDrafts();
    }
    if (!selected) {
      const current = s.periods.find(
        (p) => p.startDate <= today() && p.endDate >= today(),
      );
      selected = current?.id || null;
    }
    const p = s.periods.find((p) => p.id === selected);
    $("budget-content").hidden = !p;
    $("budget-no-period").hidden = !!p;
    if (p) {
      const f = periodFigures(s, p.id);
      $("budget-period-title").textContent = title(p);
      $("budget-range").textContent = p.startDate + "〜" + p.endDate;
      $("budget-state").textContent =
        p.state === "closed" ? "締め済み" : "未締め";
      for (const [id, value] of Object.entries({
        "budget-base-value": f.base,
        "budget-allocation-value": f.allocation,
        "budget-available": f.available,
        "budget-expense": f.expense,
        "budget-remaining": f.remaining,
        "budget-unassigned": f.unassigned,
        "pool-balance": f.balance,
        "pool-available": f.allocatable,
        "pool-unsettled": f.unsettled,
        "close-target": f.settlement,
        "close-settled": f.settled,
        "close-difference": f.settlementDifference,
        "close-projected": f.projectedBalance,
      }))
        $(id).textContent = yen(value);
      $("budget-warning").textContent =
        (f.unassigned < 0
          ? "振分超過があります。予算・振分を修正してください。 "
          : "") +
        (f.warning === "通常" ? "" : f.warning) +
        (f.usage === null
          ? "（予算0円のため使用率は表示しません）"
          : " 使用率 " + f.usage.toFixed(1) + "%");
      $("budget-warning").classList.toggle(
        "danger-text",
        f.unassigned < 0 || f.warning === "超過",
      );
      $("pool-warning").textContent =
        f.unsettled > 0
          ? "未精算額があります。解消するまで新規配分は停止します。"
          : "";
      $("pool-warning").classList.toggle("danger-text", f.unsettled > 0);
      if (!budgetDirty) {
        $("budget-base").value = f.base;
        $("category-budget-rows").replaceChildren(
          ...f.categoryRows.map((row) => {
            const label = node("label", undefined, "category-budget-row"),
              text = node("span", row.name + (row.active ? "" : "（無効）")),
              input = node("input");
            input.type = "number";
            input.min = "0";
            input.step = "1";
            input.inputMode = "numeric";
            input.value = row.budget;
            input.required = true;
            input.dataset.categoryBudget = row.id;
            input.setAttribute("aria-label", row.name + "の予算");
            const note = node(
              "small",
              "支出 " + yen(row.expense) + " ／ " + row.warning,
            );
            label.append(text, input, note);
            return label;
          }),
        );
        draftTotal();
      }
      if (!openingDirty)
        $("opening-amount").value = s.carryoverEntries.find(
          (e) => e.kind === "opening",
        ).delta;
      $("allocation-history").replaceChildren(
        ...s.carryoverEntries
          .filter((e) => e.periodId === selected && e.kind === "allocate")
          .sort((a, b) => a.sequence - b.sequence)
          .map((entry) => {
            const wrap = node("div", undefined, "allocation-row"),
              cancelled = s.carryoverEntries.some(
                (e) => e.reversalOf === entry.id,
              );
            wrap.append(
              node("span", yen(-entry.delta) + (cancelled ? " 取消済み" : "")),
            );
            if (!cancelled) {
              const b = node("button", "配分取消");
              b.type = "button";
              b.dataset.cancelAllocation = entry.id;
              b.addEventListener("click", () => {
                if (
                  confirm(
                    "この配分 " +
                      yen(-entry.delta) +
                      " を取り消しますか？ 振分済み予算が超過する場合は修正が必要です。",
                  )
                )
                  run(async () => {
                    await service().cancelAllocation(entry.id, rev());
                    await refresh();
                    notify("配分を取り消しました。");
                  });
              });
              wrap.append(b);
            }
            return wrap;
          }),
      );
      $("closing-history").replaceChildren(
        ...s.closingRevisions
          .filter((c) => c.periodId === selected)
          .sort((a, b) => a.closeRevision - b.closeRevision)
          .map((c) =>
            node(
              "p",
              "第" +
                c.closeRevision +
                "版：" +
                yen(c.previousTotal) +
                " → " +
                yen(c.newTotal) +
                "（差額 " +
                yen(c.delta) +
                "）",
              "hint",
            ),
          ),
      );
      $("close-period").textContent =
        p.state === "closed" ? "この期間を再確定" : "この期間を締める";
    } else {
      $("budget-period-title").textContent = "集計期間";
      $("budget-range").textContent = "";
    }
    const last = sortedPeriods(s).at(-1);
    $("policy-after").replaceChildren();
    if (last) {
      const o = node(
        "option",
        title(last) + " " + last.startDate + "〜" + last.endDate,
      );
      o.value = last.id;
      $("policy-after").append(o);
    }
    if (!policyDirty)
      $("policy-start-day").value = s.settings.find(
        (r) => r.key === "preferences",
      ).value.startDay;
    policyPreview();
    renderHistory();
    syncEnabled(ready);
  }
  return {
    render,
    syncEnabled,
    activate: async () => {
      if (getState().current && !selected)
        await openDate($("budget-date").value || today());
    },
    dirty: () =>
      budgetDirty || poolDirty || openingDirty || adjustDirty || policyDirty,
    reset: () => {
      selected = null;
      clearDrafts();
      $("allocate-amount").value = "";
      $("adjust-amount").value = "";
      $("adjust-memo").value = "";
      $("budget-date").value = today();
    },
  };
}
