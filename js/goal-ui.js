import { Goals, goalFigures } from "./goals.js";
import { sortedPeriods } from "./budget.js";
import { isChild } from "./share-state.js";
import { stateOf } from "./schema.js";
import { today, yen } from "./domain.js";
const $ = (id) => document.getElementById(id);
const periodLabel = (p) =>
  `${p.labelMonth}${p.kind === "transition" ? " 移行期間" : "分"}（${p.startDate}〜${p.endDate}）`;
const node = (tag, text) => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
export function createGoalUI({ getState, run, refresh, notify }) {
  let changed = false,
    snapshot = null;
  const service = () => new Goals(getState().db);
  $("goal-form").addEventListener("input", () => (changed = true));
  $("goal-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const amount = $("goal-amount").value;
      if (!amount.trim()) throw Error("目標額を入力してください");
      await service().set(
        $("goal-period").value,
        Number(amount),
        stateOf(getState().current).datasetRevision,
      );
      changed = false;
      await refresh();
      notify("目標を保存しました。変更履歴を保持しています。");
    });
  });
  $("goal-clear").addEventListener("click", () => {
    const p = snapshot?.periods.find((p) => p.id === $("goal-period").value);
    if (
      !p ||
      !confirm(
        periodLabel(p) + "から目標を解除しますか？ 過去の履歴は残ります。",
      )
    )
      return;
    run(async () => {
      await service().set(
        p.id,
        null,
        stateOf(getState().current).datasetRevision,
      );
      changed = false;
      await refresh();
      notify("目標を解除しました。履歴は保持しています。");
    });
  });
  function syncEnabled(ready) {
    const enabled =
      ready && snapshot && !isChild(snapshot) && snapshot.periods.length > 0;
    for (const id of ["goal-period", "goal-amount", "goal-save", "goal-clear"])
      $(id).disabled = !enabled;
  }
  function render(s, ready) {
    snapshot = s;
    const periods = sortedPeriods(s),
      current = periods.find(
        (p) => p.startDate <= today() && today() <= p.endDate,
      );
    if (!changed) {
      const previous = $("goal-period").value;
      $("goal-period").replaceChildren(
        ...periods.map((p) => {
          const o = node("option", periodLabel(p));
          o.value = p.id;
          return o;
        }),
      );
      $("goal-period").value = periods.some((p) => p.id === previous)
        ? previous
        : current?.id || periods.at(-1)?.id || "";
      const g = goalFigures(s, $("goal-period").value);
      $("goal-amount").value = g.target ?? "";
    }
    $("goal-permission").textContent = isChild(s)
      ? "目標の設定・解除は親端末で行い、家族統合用JSONを読み込んで反映してください。"
      : periods.length
        ? "同じ適用開始期間では最後の設定が有効です。未来期間からの変更も予約できます。"
        : "予算画面上部で集計期間を表示してから設定してください。";
    $("goal-period-label").textContent = current
      ? "現在の期間：" + periodLabel(current)
      : "現在の期間は未準備です。予算画面上部で今日を含む期間を表示してください。";
    const f = goalFigures(s, current?.id);
    $("goal-status").textContent =
      f.target === null
        ? "現在有効な目標は未設定です。"
        : `目標 ${yen(f.target)} ／ 達成率 ${f.rate.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}% ／ 目標不足額 ${yen(f.shortfall)}`;
    const n = s.goalNotifications.find((n) => n.goalRevisionId === f.goal?.id);
    const notice = n
      ? "この目標は初回達成済み：" +
        new Date(n.firstReachedAt).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        }) +
        "（日本時間）。同じ設定では再通知しません。"
      : "";
    if ($("goal-achievement").textContent !== notice)
      $("goal-achievement").textContent = notice;
    $("goal-history").replaceChildren(
      ...[...s.goalHistory]
        .sort((a, b) => b.sequence - a.sequence)
        .map((g) => {
          const p = s.periods.find((p) => p.id === g.effectivePeriodId),
            n = s.goalNotifications.find((n) => n.goalRevisionId === g.id);
          return node(
            "p",
            `${periodLabel(p)}から ／ ${g.targetAmount === null ? "解除" : yen(g.targetAmount)} ／ 設定 ${new Date(g.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）${n ? " ／ 初回達成 " + new Date(n.firstReachedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : ""}`,
          );
        }),
    );
    syncEnabled(ready);
  }
  $("goal-period").addEventListener("change", () => {
    if (snapshot)
      $("goal-amount").value =
        goalFigures(snapshot, $("goal-period").value).target ?? "";
  });
  return {
    render,
    syncEnabled,
    dirty: () => changed,
    reset: () => {
      changed = false;
      $("goal-period").value = "";
    },
  };
}
