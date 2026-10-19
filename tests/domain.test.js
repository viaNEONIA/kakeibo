import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { openDatabase } from "../js/db.js";
import {
  Ledger,
  periodBounds,
  totals,
  ensurePeriod,
  filteredTransactions,
} from "../js/domain.js";
import { DB_NAME, stateOf, uuid, now, initialStores } from "../js/schema.js";
import { validateStores } from "../js/validation.js";
globalThis.indexedDB = indexedDB;
const remove = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
async function setup(fn) {
  await remove();
  const db = await openDatabase(),
    l = new Ledger(db);
  try {
    const c = await l.saveCategory(
      { type: "expense", name: "食費" },
      undefined,
      0,
    );
    await fn(db, l, c.resultIds[0]);
  } finally {
    db.close();
    await remove();
  }
}
const rev = async (db) => stateOf(await db.snapshot()).datasetRevision;
const input = (categoryId) => ({
  type: "expense",
  date: "2026-10-20",
  amount: 350,
  name: "パン",
  memo: "",
  categoryId,
});
test("period boundaries and consecutive expansion work across leap years and both directions", () => {
  assert.deepEqual(periodBounds("2026-11-01", 25), {
    startDate: "2026-10-25",
    endDate: "2026-11-24",
    labelMonth: "2026-11",
  });
  assert.equal(periodBounds("2028-02-28", 1).endDate, "2028-02-29");
  const s = initialStores();
  ensurePeriod(s, "2026-12-31");
  const firstId = s.periods[0].id;
  ensurePeriod(s, "2027-03-01");
  ensurePeriod(s, "2026-09-30");
  validateStores(s);
  assert.equal(s.periods.length, 7);
  assert(s.periods.some((p) => p.id === firstId));
});
test("category creation, reorder and disable retain history without reusing identifiers", () =>
  setup(async (db, l, cat) => {
    const second = (
      await l.saveCategory(
        { type: "expense", name: "交通費" },
        undefined,
        await rev(db),
      )
    ).resultIds[0];
    const row = (await l.add(input(cat), await rev(db))).resultIds[0];
    await l.reorder("expense", [second, cat], await rev(db));
    let s = await db.snapshot();
    assert.equal(s.categories.find((c) => c.id === second).sortOrder, 0);
    let c = s.categories.find((c) => c.id === cat);
    await l.saveCategory(
      { id: cat, type: "expense", name: "食料品", active: false },
      c.revision,
      await rev(db),
    );
    s = await db.snapshot();
    assert.equal(s.transactions[0].categoryId, cat);
    assert.equal(s.categories.find((c) => c.id === cat).name, "食料品");
    await assert.rejects(l.add(input(cat), await rev(db)), /無効/);
    const old = s.transactions[0];
    await l.edit(
      row,
      { ...input(cat), amount: 400 },
      old.revision,
      await rev(db),
    );
    assert.equal((await db.snapshot()).transactions[0].amount, 400);
  }));
test("same amount with different operations is valid and operation retry is idempotent", () =>
  setup(async (db, l, cat) => {
    const operation = uuid(),
      data = input(cat);
    const result = await l.add(data, await rev(db), operation);
    await l.add(data, 1, operation);
    await l.add(data, await rev(db));
    const s = await db.snapshot();
    assert.equal(s.transactions.length, 2);
    assert(s.transactions.some((t) => t.id === result.resultIds[0]));
  }));
test("edit date moves record to another period; delete and refund affect correct totals", () =>
  setup(async (db, l, cat) => {
    const id = (await l.add(input(cat), await rev(db))).resultIds[0];
    let row = (await db.snapshot()).transactions[0];
    await l.edit(
      id,
      { ...input(cat), date: "2026-11-24", amount: 500 },
      row.revision,
      await rev(db),
    );
    await l.add(
      { ...input(cat), type: "refund", date: "2026-11-25", amount: 100 },
      await rev(db),
    );
    let s = await db.snapshot();
    assert.equal(totals(s.transactions).expense, 400);
    assert.equal(s.periods.length, 2);
    assert.equal(
      s.transactions[0].periodId,
      s.periods.find((p) => p.labelMonth === "2026-11").id,
    );
    row = s.transactions.find((t) => t.id === id);
    await l.remove(id, row.revision, await rev(db));
    assert.equal(totals((await db.snapshot()).transactions).expense, -100);
  }));
test("invalid amount/date/category and stale revision do not partly change periods", () =>
  setup(async (db, l, cat) => {
    for (const changes of [
      { amount: 0 },
      { amount: 1000000000 },
      { amount: 1.5 },
      { date: "2026-02-30" },
      { categoryId: uuid() },
      { type: "income" },
    ]) {
      const before = await db.snapshot();
      await assert.rejects(l.add({ ...input(cat), ...changes }, await rev(db)));
      assert.deepEqual(await db.snapshot(), before);
    }
    await l.add(input(cat), await rev(db));
    await assert.rejects(l.add(input(cat), 1), /別の画面/);
  }));
test("query combines type, date, amount, category, name, recurring and sorting", () => {
  const s = initialStores(),
    cat = uuid();
  s.categories = [{ id: cat, name: "食費" }];
  s.transactions = [
    {
      id: "a",
      type: "expense",
      date: "2026-10-20",
      amount: 100,
      name: "パン",
      memo: "",
      categoryId: cat,
      createdAt: "a",
    },
    {
      id: "b",
      type: "expense",
      date: "2026-10-21",
      amount: 300,
      name: "ご飯",
      memo: "出張",
      categoryId: cat,
      createdAt: "b",
      occurrenceId: "x",
    },
    {
      id: "c",
      type: "refund",
      date: "2026-10-21",
      amount: 50,
      name: "返金",
      memo: "",
      categoryId: cat,
      createdAt: "c",
    },
  ];
  assert.deepEqual(
    filteredTransactions(s, {
      query: "出張",
      type: "expense",
      from: "2026-10-21",
      max: "300",
      min: "200",
      recurring: true,
    }).map((t) => t.id),
    ["b"],
  );
  assert.deepEqual(
    filteredTransactions(s, { sort: "amount-asc" }).map((t) => t.id),
    ["c", "a", "b"],
  );
  assert.equal(
    filteredTransactions(s, { query: "食費", categoryId: cat }).length,
    3,
  );
  assert.throws(() => filteredTransactions(s, { min: "500", max: "100" }));
});
test("closed period corrections append delta audit; date move corrects both closed periods", () =>
  setup(async (db, l, cat) => {
    const id = (await l.add({ ...input(cat), amount: 350 }, await rev(db)))
      .resultIds[0];
    await l.add(
      { ...input(cat), date: "2026-11-01", amount: 100 },
      await rev(db),
    );
    const op = uuid();
    await db.command(
      "close-fixture",
      {},
      (s) => {
        for (const p of s.periods) {
          const at = now();
          p.state = "closed";
          s.periodBudgets.push({
            periodId: p.id,
            baseBudget: 1000,
            revision: 1,
            createdAt: at,
            updatedAt: at,
          });
          const amount =
            1000 -
            totals(s.transactions.filter((t) => t.periodId === p.id)).expense;
          const st = stateOf(s);
          st.ledgerSequence++;
          s.carryoverEntries.push({
            id: uuid(),
            periodId: p.id,
            kind: "settle",
            delta: amount,
            operationId: op,
            sequence: st.ledgerSequence,
            createdAt: at,
          });
          s.periodClosings.push({
            periodId: p.id,
            inputRevision: st.datasetRevision,
            settlementTotal: amount,
            closeRevision: 1,
            lastOperationId: op,
          });
          s.closingRevisions.push({
            id: uuid(),
            periodId: p.id,
            previousTotal: 0,
            newTotal: amount,
            delta: amount,
            closeRevision: 1,
            reason: "fixture",
            operationId: op,
            createdAt: at,
          });
        }
        return [];
      },
      { operationId: op },
    );
    let s = await db.snapshot(),
      row = s.transactions.find((t) => t.id === id);
    await l.edit(
      id,
      { ...input(cat), date: "2026-11-02", amount: 500 },
      row.revision,
      await rev(db),
    );
    s = await db.snapshot();
    const october = s.periods.find((p) => p.labelMonth === "2026-10"),
      november = s.periods.find((p) => p.labelMonth === "2026-11");
    assert.equal(
      s.periodClosings.find((c) => c.periodId === october.id).settlementTotal,
      1000,
    );
    assert.equal(
      s.periodClosings.find((c) => c.periodId === november.id).settlementTotal,
      400,
    );
    assert.equal(s.closingRevisions.length, 4);
    validateStores(s);
  }));
test("list display settings persist and invalid restore values are rejected", () =>
  setup(async (db, l) => {
    await l.saveListView(
      { sort: "amount-desc", showDate: false, showCategory: true },
      await rev(db),
    );
    const file = await db.backup();
    assert.equal(
      file.stores.settings.find((r) => r.key === "listView").value.showDate,
      false,
    );
    file.stores.settings.find((r) => r.key === "listView").value.sort =
      "random";
    await assert.rejects(db.restore(file, await rev(db)), /一覧表示/);
  }));
