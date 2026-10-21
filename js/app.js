import { Goals } from "./goals.js";
import { createGoalUI } from "./goal-ui.js";
import { fileSummary } from "./file-identity.js";
import { createFileSaver } from "./file-save.js";
import { canRecoverParent } from "./restore-policy.js";
import { createShareUI } from "./share-ui.js";
import { isChild } from "./share-state.js";
import { createBudgetUI } from "./budget-ui.js";
import { periodFigures, poolBalance } from "./budget.js";
import { openDatabase } from "./db.js";
import { APP_VERSION, stateOf, STORE_NAMES, uuid } from "./schema.js";
import { validateBackup } from "./validation.js";
import {
  Ledger,
  today,
  periodBounds,
  totals,
  filteredTransactions,
  yen,
} from "./domain.js";
const $ = (id) => document.getElementById(id);
const fileSaver = createFileSaver();
const screens = ["home", "budget", "input", "list", "settings"];
let budgetUI, shareUI, goalUI;
let db,
  ledger,
  current,
  busy = false,
  outdated = false,
  closed = false,
  pending = null,
  waitingWorker = null,
  applyingUpdate = false;
let inputType = "expense",
  categoryType = "expense",
  selected = { expense: null, income: null },
  lastAdd = null,
  submission = null,
  editing = null,
  editingCategory = null;
let inputDirty = false,
  preferenceDirty = false,
  editDirty = false,
  categoryDirty = false;
const dirty = () =>
  inputDirty ||
  preferenceDirty ||
  editDirty ||
  categoryDirty ||
  !!budgetUI?.dirty() ||
  !!goalUI?.dirty();
const categoryGroup = () => (inputType === "income" ? "income" : "expense");
const activeCategories = (type) =>
  current.categories
    .filter((c) => c.type === type && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function network() {
  $("network").textContent = navigator.onLine ? "オンライン" : "オフライン";
}
function canWrite() {
  return !!db && !busy && !outdated && !closed;
}
function controls() {
  const ready = canWrite();
  for (const note of document.querySelectorAll("[data-export-state]")) {
    note.hidden = ready;
    note.textContent = busy
      ? "処理中です。完了後に操作できます。"
      : outdated
        ? "別の画面で変更されています。「最新データを読み込む」で更新してから保存してください。"
        : closed
          ? "接続が閉じられています。ページを再読み込みしてください。"
          : "保存を利用できません。画面のエラーを確認してください。";
  }
  for (const id of [
    "save",
    "backup",
    "restore-file",
    "add-category",
    "save-view",
  ])
    $(id).disabled = !ready;
  for (const button of document.querySelectorAll("[data-write]"))
    button.disabled = !ready;
  const amount = Number($("amount").value);
  $("register").disabled =
    !ready ||
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    !selected[categoryGroup()];
  $("undo").disabled = !ready;
  $("confirm-restore").disabled =
    !ready ||
    (!!pending?.parentRecovery && !$("parent-recovery-confirm").checked);
  budgetUI?.syncEnabled(ready);
  goalUI?.syncEnabled(ready);
  shareUI?.render(current, ready);
  if (current && isChild(current)) {
    for (const id of [
      "save",
      "add-category",
      "budget-save",
      "budget-copy",
      "adjust-submit",
      "close-period",
      "allocate-submit",
      "opening-submit",
      "policy-submit",
    ])
      $(id).disabled = true;
    for (const b of document.querySelectorAll(
      "[data-cancel-allocation],#category-list button",
    ))
      b.disabled = true;
  }
}
function stale() {
  outdated = true;
  controls();
  $("reload").hidden = closed;
  message(
    "別の画面で変更されました。入力内容を確認してから最新データを読み込んでください。",
    true,
  );
}
async function action(fn) {
  if (!canWrite()) return false;
  busy = true;
  controls();
  try {
    await fn();
    return true;
  } catch (e) {
    if (/別の画面|変更されています|読み込み直して/.test(e.message)) stale();
    message(e.message || "保存に失敗しました。入力は保持しています。", true);
    return false;
  } finally {
    busy = false;
    controls();
  }
}
function navigate(screen) {
  if (!screens.includes(screen)) screen = "home";
  location.hash = screen;
  showScreen(screen);
  if (screen === "budget") budgetUI?.activate();
}
function showScreen(screen) {
  if (!screens.includes(screen)) screen = "home";
  for (const name of screens) $("screen-" + name).hidden = name !== screen;
  for (const a of document.querySelectorAll("[data-screen]")) {
    if (a.dataset.screen === screen) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", () => {
  showScreen(location.hash.slice(1));
  if (location.hash === "#budget") budgetUI?.activate();
});
showScreen(
  screens.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home",
);
$("transaction-date").value = today();
for (const [id, target] of [
  ["home-input", "input"],
  ["home-list", "list"],
  ["home-budget", "budget"],
  ["list-add", "input"],
])
  $(id).addEventListener("click", () => navigate(target));
$("manage-from-input").addEventListener("click", () => {
  categoryType = categoryGroup();
  renderCategoryManager();
  navigate("settings");
});
function transactionButton(row, { showDate = true, showCategory = true } = {}) {
  const category = current.categories.find((c) => c.id === row.categoryId),
    button = element("button", undefined, "transaction-row");
  button.type = "button";
  button.dataset.transactionId = row.id;
  button.setAttribute(
    "aria-label",
    `${row.date} ${row.name || category?.name || "名称なし"} ${row.type === "income" ? "収入" : row.type === "refund" ? "返金" : "支出"} ${yen(row.amount)}を編集`,
  );
  if (showDate)
    button.append(
      element("span", row.date.slice(2).replaceAll("-", "/"), "date"),
    );
  button.append(
    element("span", row.name || category?.name || "名称なし", "name"),
  );
  if (showCategory && row.name)
    button.append(element("span", category?.name || "項目なし", "category"));
  button.append(
    element(
      "span",
      (row.type === "expense" ? "−" : "+") + yen(row.amount),
      "money " + row.type,
    ),
  );
  button.addEventListener("click", () => openEdit(row.id));
  return button;
}
function renderCategories() {
  const type = categoryGroup(),
    rows = activeCategories(type);
  if (!rows.some((c) => c.id === selected[type]))
    selected[type] = rows[0]?.id || null;
  $("category-buttons").replaceChildren();
  $("category-select").replaceChildren();
  for (const row of rows) {
    const option = element("option", row.name);
    option.value = row.id;
    $("category-select").append(option);
  }
  if (!rows.length) {
    const note = element("div", "先に項目を追加してください。", "empty");
    const add = element("button", "＋ 項目を追加");
    add.type = "button";
    add.addEventListener("click", () => {
      categoryType = type;
      renderCategoryManager();
      navigate("settings");
      openCategory();
    });
    $("category-buttons").append(note, add);
  }
  for (const row of rows.slice(0, 6)) {
    const button = element("button", row.name);
    button.type = "button";
    button.dataset.categoryId = row.id;
    button.classList.toggle("selected", row.id === selected[type]);
    button.setAttribute("aria-pressed", String(row.id === selected[type]));
    button.addEventListener("click", () => {
      selected[type] = row.id;
      inputDirty = true;
      submission = null;
      renderCategories();
      controls();
    });
    $("category-buttons").append(button);
  }
  if (rows.length > 6) {
    const extra = rows.slice(6).find((c) => c.id === selected[type]);
    const more = element("button", extra ? "その他：" + extra.name : "その他");
    more.id = "show-more-categories";
    more.type = "button";
    more.classList.toggle("selected", !!extra);
    more.addEventListener("click", () => {
      $("more-categories").hidden = !$("more-categories").hidden;
    });
    $("category-buttons").append(more);
  } else $("more-categories").hidden = true;
  $("category-select").value = selected[type] || "";
  for (const b of document.querySelectorAll("[data-type]"))
    b.setAttribute("aria-pressed", String(b.dataset.type === inputType));
  $("register").textContent =
    (inputType === "income"
      ? "収入"
      : inputType === "refund"
        ? "返金"
        : "支出") + "を登録";
}
$("category-select").addEventListener("change", () => {
  selected[categoryGroup()] = $("category-select").value;
  inputDirty = true;
  submission = null;
  renderCategories();
  controls();
});
for (const b of document.querySelectorAll("[data-type]"))
  b.addEventListener("click", () => {
    inputType = b.dataset.type;
    inputDirty = true;
    submission = null;
    renderCategories();
    controls();
  });
function enterKey(key) {
  let value = $("amount").value;
  if (key === "backspace") value = value.slice(0, -1);
  else if (key === "clear") value = "";
  else {
    const next = (value + key).replace(/^0+(?=\d)/, "");
    if (next.length > 9) {
      message("金額は999,999,999円までです。", true);
      return;
    }
    value = next;
  }
  $("amount").value = value;
  inputDirty = true;
  submission = null;
  controls();
}
$("keypad").addEventListener("click", (e) => {
  const key = e.target.closest("[data-key]")?.dataset.key;
  if (key) enterKey(key);
});
$("clear-amount").addEventListener("click", () => enterKey("clear"));
$("amount").addEventListener("keydown", (e) => {
  if (/^\d$/.test(e.key)) {
    e.preventDefault();
    enterKey(e.key);
  } else if (e.key === "Backspace") {
    e.preventDefault();
    enterKey("backspace");
  } else if (e.key === "Delete") {
    e.preventDefault();
    enterKey("clear");
  }
});
for (const id of ["transaction-date", "transaction-name", "transaction-memo"])
  $(id).addEventListener("input", () => {
    inputDirty = true;
    submission = null;
  });
$("transaction-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    const input = {
      type: inputType,
      date: $("transaction-date").value,
      amount: Number($("amount").value),
      categoryId: selected[categoryGroup()],
      name: $("transaction-name").value,
      memo: $("transaction-memo").value,
    };
    const fingerprint = JSON.stringify(input);
    if (!submission || submission.fingerprint !== fingerprint)
      submission = { id: uuid(), fingerprint };
    const receipt = await ledger.add(
      input,
      stateOf(current).datasetRevision,
      submission.id,
    );
    lastAdd = {
      id: receipt.resultIds[0],
      revision: 1,
      datasetId: db.generation,
    };
    submission = null;
    inputDirty = false;
    $("amount").value = "";
    $("transaction-name").value = "";
    $("transaction-memo").value = "";
    await render();
    $("undo").hidden = false;
    message("登録しました。続けて入力できます。");
  });
});
$("undo").addEventListener("click", () =>
  action(async () => {
    if (!lastAdd || lastAdd.datasetId !== db.generation)
      throw Error("直前の記録は取り消せません。一覧で確認してください");
    await ledger.remove(
      lastAdd.id,
      lastAdd.revision,
      stateOf(current).datasetRevision,
    );
    lastAdd = null;
    $("undo").hidden = true;
    await render();
    message("直前の登録を取り消しました。");
  }),
);
function filterValues() {
  return {
    query: $("filter-query").value,
    type: $("filter-type").value,
    categoryId: $("filter-category").value,
    from: $("filter-from").value,
    to: $("filter-to").value,
    min: $("filter-min").value,
    max: $("filter-max").value,
    recurring: $("filter-recurring").checked,
    sort: $("list-sort").value,
  };
}
function renderList() {
  try {
    const f = filterValues();
    if (f.from && f.to && f.from > f.to)
      throw Error("開始日は終了日以前にしてください");
    const rows = filteredTransactions(current, f);
    $("filter-error").textContent = "";
    $("list-count").textContent = rows.length + "件";
    $("transaction-list").replaceChildren(
      ...rows.map((row) =>
        transactionButton(row, {
          showDate: $("show-date").checked,
          showCategory: $("show-category").checked,
        }),
      ),
    );
    if (!rows.length)
      $("transaction-list").append(
        element("p", "該当する記録はありません。", "empty-note"),
      );
  } catch (e) {
    $("filter-error").textContent = e.message;
    $("list-count").textContent = "";
    $("transaction-list").replaceChildren();
  }
}
$("filter-form").addEventListener("submit", (e) => e.preventDefault());
$("filter-form").addEventListener("input", () => {
  if (current) renderList();
});
$("filter-form").addEventListener("change", () => {
  if (current) renderList();
});
$("reset-filters").addEventListener("click", () => {
  for (const id of [
    "filter-query",
    "filter-type",
    "filter-category",
    "filter-from",
    "filter-to",
    "filter-min",
    "filter-max",
  ])
    $(id).value = "";
  $("filter-recurring").checked = false;
  renderList();
});
$("save-view").addEventListener("click", () =>
  action(async () => {
    await ledger.saveListView(
      {
        sort: $("list-sort").value,
        showDate: $("show-date").checked,
        showCategory: $("show-category").checked,
      },
      stateOf(current).datasetRevision,
    );
    await render();
    message("一覧の表示設定を保存しました。");
  }),
);
function renderCategoryManager() {
  if (!current) return;
  for (const b of document.querySelectorAll("[data-category-type]"))
    b.setAttribute(
      "aria-pressed",
      String(b.dataset.categoryType === categoryType),
    );
  const rows = current.categories
    .filter((c) => c.type === categoryType)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  $("category-list").replaceChildren();
  rows.forEach((row, index) => {
    const wrap = element("div", undefined, "category-row"),
      name = element(
        "span",
        row.name + (row.active ? "" : "（無効）"),
        "category-name" + (row.active ? "" : " inactive"),
      );
    wrap.append(name);
    for (const [delta, label] of [
      [-1, "↑"],
      [1, "↓"],
    ]) {
      const button = element("button", label);
      button.type = "button";
      button.setAttribute(
        "aria-label",
        row.name + (delta < 0 ? "を上へ" : "を下へ"),
      );
      if (index + delta < 0 || index + delta >= rows.length)
        button.disabled = true;
      else {
        button.dataset.write = "";
        button.addEventListener("click", () =>
          action(async () => {
            const ids = rows.map((c) => c.id);
            [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
            await ledger.reorder(
              categoryType,
              ids,
              stateOf(current).datasetRevision,
            );
            await render();
            message("項目の順序を変更しました。");
          }),
        );
      }
      wrap.append(button);
    }
    const edit = element("button", "編集");
    edit.type = "button";
    edit.dataset.write = "";
    edit.setAttribute("aria-label", row.name + "を編集");
    edit.addEventListener("click", () => openCategory(row.id));
    wrap.append(edit);
    $("category-list").append(wrap);
  });
  if (!rows.length)
    $("category-list").append(
      element("p", "項目を追加してください。", "empty-note"),
    );
}
for (const b of document.querySelectorAll("[data-category-type]"))
  b.addEventListener("click", () => {
    categoryType = b.dataset.categoryType;
    renderCategoryManager();
    controls();
  });
function openCategory(id) {
  editingCategory = id
    ? structuredClone(current.categories.find((c) => c.id === id))
    : null;
  categoryDirty = false;
  $("category-title").textContent = id ? "項目を編集" : "項目を追加";
  $("category-name").value = editingCategory?.name || "";
  $("category-active").checked = editingCategory?.active ?? true;
  $("category-dialog").showModal();
}
$("add-category").addEventListener("click", () => openCategory());
$("category-form").addEventListener("input", () => {
  categoryDirty = true;
});
$("category-form").addEventListener("submit", (e) => {
  e.preventDefault();
  action(async () => {
    await ledger.saveCategory(
      {
        id: editingCategory?.id,
        type: editingCategory?.type || categoryType,
        name: $("category-name").value,
        active: $("category-active").checked,
      },
      editingCategory?.revision,
      stateOf(current).datasetRevision,
    );
    categoryDirty = false;
    $("category-dialog").close();
    await render();
    message("項目を保存しました。");
  });
});
function editOptions() {
  const type = $("edit-type").value === "income" ? "income" : "expense",
    rows = current.categories
      .filter(
        (c) => c.type === type && (c.active || c.id === editing?.categoryId),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  const keep = $("edit-category").value || editing?.categoryId;
  $("edit-category").replaceChildren(
    ...rows.map((c) => {
      const o = element("option", c.name + (c.active ? "" : "（無効）"));
      o.value = c.id;
      return o;
    }),
  );
  if (rows.some((c) => c.id === keep)) $("edit-category").value = keep;
}
function openEdit(id) {
  editing = structuredClone(current.transactions.find((t) => t.id === id));
  if (!editing) return;
  editDirty = false;
  $("edit-type").value = editing.type;
  $("edit-type").disabled = !!editing.occurrenceId;
  $("edit-date").value = editing.date;
  $("edit-date").disabled = !!editing.occurrenceId;
  $("edit-amount").value = editing.amount;
  $("edit-category").replaceChildren();
  editOptions();
  $("edit-name").value = editing.name;
  $("edit-memo").value = editing.memo;
  $("edit-dialog").showModal();
  controls();
}
$("edit-type").addEventListener("change", editOptions);
$("edit-form").addEventListener("input", () => {
  editDirty = true;
});
$("edit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  action(async () => {
    await ledger.edit(
      editing.id,
      {
        type: $("edit-type").value,
        date: $("edit-date").value,
        amount: Number($("edit-amount").value),
        categoryId: $("edit-category").value,
        name: $("edit-name").value,
        memo: $("edit-memo").value,
      },
      editing.revision,
      stateOf(current).datasetRevision,
    );
    if (lastAdd?.id === editing.id) {
      lastAdd = null;
      $("undo").hidden = true;
    }
    editDirty = false;
    $("edit-dialog").close();
    await render();
    message("記録を更新しました。");
  });
});
$("delete-transaction").addEventListener("click", () => {
  if (confirm("この記録を削除しますか？"))
    action(async () => {
      await ledger.remove(
        editing.id,
        editing.revision,
        stateOf(current).datasetRevision,
      );
      if (lastAdd?.id === editing.id) {
        lastAdd = null;
        $("undo").hidden = true;
      }
      editDirty = false;
      $("edit-dialog").close();
      await render();
      message("記録を削除しました。");
    });
});
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () => {
    const id = button.dataset.close;
    const hasChanges = id === "edit-dialog" ? editDirty : categoryDirty;
    if (hasChanges && !confirm("変更を破棄して閉じますか？")) return;
    $(id).close();
    if (id === "edit-dialog") editDirty = false;
    else categoryDirty = false;
  });
for (const [id, key] of [
  ["edit-dialog", "edit"],
  ["category-dialog", "category"],
])
  $(id).addEventListener("cancel", (event) => {
    const changed = key === "edit" ? editDirty : categoryDirty;
    if (changed && !confirm("変更を破棄して閉じますか？"))
      event.preventDefault();
    else if (key === "edit") editDirty = false;
    else categoryDirty = false;
  });
async function render(resetView = false) {
  await new Goals(db).check();
  current = await db.snapshot();
  if (stateOf(current).datasetId !== db.generation) {
    stale();
    return;
  }
  if (resetView) {
    const view = current.settings.find((r) => r.key === "listView")?.value || {
      sort: "date-desc",
      showDate: true,
      showCategory: true,
    };
    $("list-sort").value = view.sort;
    $("show-date").checked = view.showDate;
    $("show-category").checked = view.showCategory;
  }
  if (!preferenceDirty)
    $("warning-percent").value = current.settings.find(
      (r) => r.key === "preferences",
    ).value.warningPercent;
  $("record-count").textContent =
    STORE_NAMES.reduce((n, k) => n + current[k].length, 0) + "件";
  $("db-status").textContent = "この端末に保存できます";
  const existing = current.periods.find(
      (p) => p.startDate <= today() && p.endDate >= today(),
    ),
    bounds =
      existing ||
      periodBounds(
        today(),
        current.settings.find((r) => r.key === "preferences").value.startDay,
      );
  $("home-period").textContent = bounds.labelMonth.replace("-", "年") + "月分";
  $("home-range").textContent = bounds.startDate + " 〜 " + bounds.endDate;
  const sum = totals(
    current.transactions.filter(
      (t) => t.date >= bounds.startDate && t.date <= bounds.endDate,
    ),
  );
  $("home-income").textContent = yen(sum.income);
  $("home-expense").textContent = yen(sum.expense);
  $("home-net").textContent = yen(sum.net);
  const recent = filteredTransactions(current).slice(0, 5);
  $("recent-list").replaceChildren(
    ...recent.map((row) => transactionButton(row)),
  );
  if (!recent.length)
    $("recent-list").append(
      element(
        "p",
        "まだ記録がありません。入力から始めましょう。",
        "empty-note",
      ),
    );
  const filterCategory = $("filter-category").value;
  $("filter-category").replaceChildren(element("option", "すべて"));
  $("filter-category").firstChild.value = "";
  for (const c of current.categories) {
    const option = element("option", c.name + (c.active ? "" : "（無効）"));
    option.value = c.id;
    $("filter-category").append(option);
  }
  if (current.categories.some((c) => c.id === filterCategory))
    $("filter-category").value = filterCategory;
  const homeFigures = existing
    ? periodFigures(current, existing.id)
    : {
        base: 0,
        allocation: 0,
        available: 0,
        remaining: -sum.expense,
        balance: poolBalance(current),
        unsettled: Math.max(-poolBalance(current), 0),
        warning: sum.expense > 0 ? "未予算支出" : "通常",
        categoryRows: [],
      };
  for (const [id, value] of Object.entries({
    "home-base": homeFigures.base,
    "home-allocation": homeFigures.allocation,
    "home-available": homeFigures.available,
    "home-remaining": homeFigures.remaining,
    "home-pool": homeFigures.balance,
    "home-unsettled": homeFigures.unsettled,
  }))
    $(id).textContent = yen(value);
  $("home-budget-warning").textContent =
    (homeFigures.unsettled > 0
      ? "未精算額があります。新規配分は停止中です。 "
      : "") + (homeFigures.warning !== "通常" ? homeFigures.warning : "");
  $("home-budget-warning").classList.toggle(
    "danger-text",
    homeFigures.unsettled > 0 || homeFigures.warning === "超過",
  );
  $("home-category-warnings").replaceChildren(
    ...homeFigures.categoryRows
      .filter((c) =>
        ["注意", "使い切り", "超過", "未予算支出"].includes(c.warning),
      )
      .map((c) =>
        element(
          "li",
          c.name +
            "：" +
            c.warning +
            "（支出 " +
            yen(c.expense) +
            " / 予算 " +
            yen(c.budget) +
            "）",
        ),
      ),
  );
  renderCategories();
  renderCategoryManager();
  renderList();
  budgetUI?.render(current);
  goalUI?.render(current, canWrite());
  controls();
}
$("warning-percent").addEventListener("input", () => {
  preferenceDirty = true;
});
$("preferences").addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    await db.savePreferences(
      { warningPercent: Number($("warning-percent").value) },
      stateOf(current).datasetRevision,
    );
    preferenceDirty = false;
    await render();
    message("設定を保存しました。");
  });
});
$("backup").addEventListener("click", () =>
  action(async () => {
    await fileSaver.export(() => db.backup(), {
      label: "復元用バックアップ",
      onPrepared: () => {
        $("last-backup").textContent =
          new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) +
          "（保存完了は未確認）";
      },
    });
    message(
      "JSONを準備しました。保存通知が出ない場合は、画面の「JSONを保存」を直接押してください。",
    );
  }),
);
$("restore-file").addEventListener("change", () =>
  action(async () => {
    const file = $("restore-file").files[0];
    $("restore-file").value = "";
    if (!file) return;
    const data = validateBackup(JSON.parse(await file.text()));
    const snap = await db.snapshot();
    if (stateOf(snap).datasetId !== db.generation)
      throw Error("別の画面で復元されています。最新データを読み込んでください");
    const parentRecovery = canRecoverParent(snap, data.stores);
    pending = { data, revision: stateOf(snap).datasetRevision, parentRecovery };
    $("parent-recovery-option").hidden = !parentRecovery;
    $("parent-recovery-confirm").checked = false;
    $("restore-title").textContent = parentRecovery
      ? "バックアップから親を復旧します"
      : "現在のデータを置き換えます";
    $("confirm-restore").textContent = parentRecovery
      ? "親として全量復旧"
      : "全量上書きで復元";
    $("restore-summary").textContent =
      fileSummary(data, file.name) +
      " ／ 全量上書きによる復元です。家族の変更を統合する操作ではありません。収支を含む保存データ総数：" +
      Object.values(data.recordCounts).reduce((a, b) => a + b, 0) +
      "件のデータです。";
    $("restore-dialog").showModal();
  }),
);
$("parent-recovery-confirm").addEventListener("change", controls);
$("cancel-restore").addEventListener("click", () => {
  pending = null;
  $("restore-dialog").close();
});
$("restore-dialog").addEventListener("cancel", () => {
  pending = null;
});
$("confirm-restore").addEventListener("click", () =>
  action(async () => {
    if (!pending) return;
    const recoveredParent = pending.parentRecovery;
    if (recoveredParent && !$("parent-recovery-confirm").checked)
      throw Error("親としての復旧確認が必要です");
    await db.restore(pending.data, pending.revision, {
      recoverParent: recoveredParent,
    });
    pending = null;
    inputDirty = preferenceDirty = false;
    lastAdd = null;
    submission = null;
    $("undo").hidden = true;
    $("amount").value = "";
    $("transaction-name").value = "";
    $("transaction-memo").value = "";
    $("restore-dialog").close();
    budgetUI?.reset();
    goalUI?.reset();
    shareUI?.reset();
    await render(true);
    message(
      recoveredParent
        ? "親としてデータと端末識別情報を復旧しました。旧親は同時に使用しないでください。"
        : "すべてのデータを復元しました。",
    );
  }),
);
$("reload").addEventListener("click", async () => {
  if (busy || closed) return;
  if (dirty() && !confirm("保存していない変更を破棄して読み込みますか？"))
    return;
  try {
    await db.refresh();
    inputDirty = preferenceDirty = editDirty = categoryDirty = false;
    outdated = false;
    pending = null;
    lastAdd = null;
    submission = null;
    $("undo").hidden = true;
    $("amount").value = "";
    $("transaction-name").value = "";
    $("transaction-memo").value = "";
    for (const id of ["restore-dialog", "edit-dialog", "category-dialog"])
      $(id).close();
    $("reload").hidden = true;
    budgetUI?.reset();
    goalUI?.reset();
    shareUI?.reset();
    await render(true);
    message("最新のデータを読み込みました。");
  } catch (e) {
    message(e.message, true);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty() && !applyingUpdate) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("online", network);
window.addEventListener("offline", network);
network();
$("update").addEventListener("click", () => {
  if (busy) return;
  if (confirm("保存していない変更を破棄して新しいバージョンへ更新しますか？")) {
    applyingUpdate = true;
    waitingWorker?.postMessage({ type: "APPLY_UPDATE" });
  }
});
async function pwa() {
  if (!("serviceWorker" in navigator)) {
    $("offline-status").textContent =
      "この環境はオフライン起動に対応していません。";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", {
      updateViaCache: "none",
    });
    navigator.serviceWorker.ready.then(() => {
      $("offline-status").textContent = "オフライン起動の準備ができました。";
    });
    const show = () => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker = reg.waiting;
        $("update-panel").hidden = false;
      }
    };
    show();
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker?.addEventListener("statechange", () => {
        show();
        if (worker.state === "redundant") {
          $("offline-status").textContent = "オフライン準備に失敗しました。";
          message(
            "オフライン用データの準備に失敗しました。通信を確認して再起動してください。",
            true,
          );
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (applyingUpdate) location.reload();
      else if (dirty())
        message(
          "更新を検知しました。編集中の内容を保存してから再起動してください。",
        );
    });
  } catch {
    $("offline-status").textContent = "オフライン準備に失敗しました。";
    message(
      "オフライン準備に失敗しました。通信を確認して再起動してください。",
      true,
    );
  }
}
goalUI = createGoalUI({
  getState: () => ({ db, current }),
  run: action,
  refresh: render,
  notify: message,
});
budgetUI = createBudgetUI({
  getState: () => ({ db, current }),
  run: action,
  refresh: render,
  notify: message,
});
shareUI = createShareUI({
  exportFile: (getData, options) => fileSaver.export(getData, options),
  getState: () => ({ db, current }),
  run: action,
  refresh: async () => {
    lastAdd = null;
    submission = null;
    $("undo").hidden = true;
    budgetUI?.reset();
    goalUI?.reset();
    await render(true);
  },
  notify: message,
  hasDraft: dirty,
});
try {
  db = await openDatabase({
    onBlocked: () =>
      message("ほかのタブを閉じてから再読み込みしてください。", true),
    onVersionChange: () => {
      closed = true;
      controls();
      $("reload").hidden = true;
      message(
        "新しいバージョンを使用するため、編集中の内容を控えてアプリを再起動してください。",
        true,
      );
    },
    onChange: () => {
      if (!current || busy) return;
      stale();
    },
  });
  ledger = new Ledger(db);
  current = await db.snapshot();
  const view = current.settings.find((r) => r.key === "listView")?.value;
  if (view) {
    $("list-sort").value = view.sort;
    $("show-date").checked = view.showDate;
    $("show-category").checked = view.showCategory;
  }
  await render();
  controls();
  await pwa();
  if (location.hash === "#budget") await budgetUI.activate();
} catch (e) {
  $("db-status").textContent = "保存を開始できませんでした";
  message(e.message, true);
}
console.info("Kakeibo", APP_VERSION);
