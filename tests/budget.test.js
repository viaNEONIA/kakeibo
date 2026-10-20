import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { openDatabase } from "../js/db.js";
import { DB_NAME, stateOf, uuid } from "../js/schema.js";
import { Ledger } from "../js/domain.js";
import {
  BudgetLedger,
  periodFigures,
  poolBalance,
  poolHistory,
  sortedPeriods,
} from "../js/budget.js";
globalThis.indexedDB = indexedDB;
const clear = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
  });
const revision = async (db) => stateOf(await db.snapshot()).datasetRevision;
async function setup(fn) {
  await clear();
  const db = await openDatabase(),
    ledger = new Ledger(db),
    budget = new BudgetLedger(db);
  try {
    const cat = (
      await ledger.saveCategory({ type: "expense", name: "食費" }, undefined, 0)
    ).resultIds[0];
    const p = (await budget.select("2026-10-20", await revision(db)))
      .resultIds[0];
    await fn({ db, ledger, budget, cat, p });
  } finally {
    db.close();
    await clear();
  }
}
async function expense(c, amount, date = "2026-10-20") {
  return c.ledger.add(
    {
      type: "expense",
      amount,
      date,
      categoryId: c.cat,
      name: "試験",
      memo: "",
    },
    await revision(c.db),
  );
}
test("official settlement examples including overspend and exact repeated close", async () => {
  for (const [amount, expected] of [
    [90000, 40000],
    [110000, 20000],
    [120000, 10000],
    [130000, 0],
    [140000, -10000],
  ])
    await setup(async (c) => {
      await c.budget.setOpening(30000, await revision(c.db));
      await c.budget.save(
        c.p,
        100000,
        [{ categoryId: c.cat, amount: 100000 }],
        await revision(c.db),
      );
      await c.budget.allocate(c.p, 20000, await revision(c.db));
      await expense(c, amount);
      const preview = periodFigures(await c.db.snapshot(), c.p);
      assert.equal(preview.projectedBalance, expected);
      await c.budget.close(c.p, await revision(c.db));
      let s = await c.db.snapshot();
      assert.equal(poolBalance(s), expected);
      const n = s.carryoverEntries.length,
        h = s.closingRevisions.length;
      await c.budget.close(c.p, await revision(c.db));
      s = await c.db.snapshot();
      assert.equal(poolBalance(s), expected);
      assert.equal(s.carryoverEntries.length, n);
      assert.equal(s.closingRevisions.length, h);
    });
});
test("overspend is retained and future surplus resolves it once", () =>
  setup(async (c) => {
    await c.budget.save(c.p, 1000, [], await revision(c.db));
    await expense(c, 2000);
    await c.budget.close(c.p, await revision(c.db));
    assert.equal(periodFigures(await c.db.snapshot(), c.p).unsettled, 1000);
    await assert.rejects(
      c.budget.allocate(c.p, 1, await revision(c.db)),
      /停止/,
    );
    for (const [date, base] of [
      ["2026-11-01", 600],
      ["2026-12-01", 700],
    ]) {
      const id = (await c.budget.select(date, await revision(c.db)))
        .resultIds[0];
      await c.budget.save(id, base, [], await revision(c.db));
      await c.budget.close(id, await revision(c.db));
    }
    assert.equal(poolBalance(await c.db.snapshot()), 300);
  }));
test("category oversubscription rejected; zero budget and refund edge cases", () =>
  setup(async (c) => {
    const before = await c.db.snapshot();
    await assert.rejects(
      c.budget.save(
        c.p,
        100,
        [{ categoryId: c.cat, amount: 101 }],
        await revision(c.db),
      ),
      /振分合計/,
    );
    assert.deepEqual(await c.db.snapshot(), before);
    await expense(c, 100);
    assert.equal(
      periodFigures(await c.db.snapshot(), c.p).warning,
      "未予算支出",
    );
    await c.ledger.add(
      {
        type: "refund",
        date: "2026-10-20",
        categoryId: c.cat,
        amount: 150,
        name: "返金",
        memo: "",
      },
      await revision(c.db),
    );
    await c.budget.close(c.p, await revision(c.db));
    assert.equal(poolBalance(await c.db.snapshot()), 50);
  }));
test("80/100/over thresholds use source values and zero does not divide", () =>
  setup(async (c) => {
    await c.budget.save(c.p, 100, [], await revision(c.db));
    const id = (await expense(c, 79)).resultIds[0];
    for (const [amount, expected] of [
      [79, "通常"],
      [80, "注意"],
      [100, "使い切り"],
      [101, "超過"],
    ]) {
      const row = (await c.db.snapshot()).transactions.find((t) => t.id === id);
      await c.ledger.edit(
        id,
        { ...row, amount },
        row.revision,
        await revision(c.db),
      );
      assert.equal(periodFigures(await c.db.snapshot(), c.p).warning, expected);
    }
    await c.budget.save(c.p, 0, [], await revision(c.db));
    assert.equal(periodFigures(await c.db.snapshot(), c.p).usage, null);
  }));
test("allocation/cancellation reject double reversal and keep closed-period net balance", () =>
  setup(async (c) => {
    await c.budget.setOpening(30000, await revision(c.db));
    await c.budget.save(c.p, 100000, [], await revision(c.db));
    const allocation = (
      await c.budget.allocate(c.p, 20000, await revision(c.db))
    ).resultIds[0];
    await expense(c, 110000);
    await c.budget.close(c.p, await revision(c.db));
    assert.equal(poolBalance(await c.db.snapshot()), 20000);
    await c.budget.cancelAllocation(allocation, await revision(c.db));
    let s = await c.db.snapshot();
    assert.equal(poolBalance(s), 20000);
    assert.equal(periodFigures(s, c.p).allocation, 0);
    assert.equal(
      s.carryoverEntries.filter((e) => e.kind === "reverse").length,
      1,
    );
    await assert.rejects(
      c.budget.cancelAllocation(allocation, await revision(c.db)),
      /取消済み/,
    );
    assert.equal(
      (await c.db.snapshot()).carryoverEntries.length,
      s.carryoverEntries.length,
    );
  }));
test("prior edits recalculate downstream pool but preserve allocations", () =>
  setup(async (c) => {
    await c.budget.setOpening(30000, await revision(c.db));
    await c.budget.save(c.p, 100000, [], await revision(c.db));
    await c.budget.allocate(c.p, 20000, await revision(c.db));
    const id = (await expense(c, 110000)).resultIds[0];
    await c.budget.close(c.p, await revision(c.db));
    const next = (await c.budget.select("2026-11-01", await revision(c.db)))
      .resultIds[0];
    await c.budget.allocate(next, 15000, await revision(c.db));
    const row = (await c.db.snapshot()).transactions.find((t) => t.id === id);
    await c.ledger.edit(
      id,
      { ...row, amount: 125000 },
      row.revision,
      await revision(c.db),
    );
    const s = await c.db.snapshot();
    assert.equal(poolBalance(s), -10000);
    assert.equal(
      s.carryoverEntries.filter((e) => e.kind === "allocate").length,
      2,
    );
    const history = poolHistory(s);
    assert.equal(history[0].end, 5000);
    assert.equal(history[1].end, -10000);
    assert.equal(history[0].overspend, 5000);
    assert.equal(history[0].addition, 0);
  }));
test("copy only prior budget and distributions; reject overflow in destination", () =>
  setup(async (c) => {
    await c.budget.setOpening(5000, await revision(c.db));
    await c.budget.save(
      c.p,
      1000,
      [{ categoryId: c.cat, amount: 800 }],
      await revision(c.db),
    );
    await expense(c, 200);
    const next = (await c.budget.select("2026-11-01", await revision(c.db)))
      .resultIds[0];
    await c.budget.copyPrevious(next, await revision(c.db));
    let s = await c.db.snapshot();
    assert.equal(s.transactions.length, 1);
    assert.equal(periodFigures(s, next).allocation, 0);
    assert.equal(
      s.periodBudgets.find((b) => b.periodId === next).baseBudget,
      1000,
    );
    assert.equal(
      s.categoryBudgets.find((b) => b.periodId === next).amount,
      800,
    );
    await c.budget.allocate(c.p, 1000, await revision(c.db));
    await c.budget.save(
      c.p,
      1000,
      [{ categoryId: c.cat, amount: 2000 }],
      await revision(c.db),
    );
    await assert.rejects(
      c.budget.copyPrevious(next, await revision(c.db)),
      /振分合計/,
    );
  }));
test("adjustments, cancellation and insufficient concurrent allocation are atomic", () =>
  setup(async (c) => {
    await c.budget.setOpening(1000, await revision(c.db));
    const expected = await revision(c.db);
    const results = await Promise.allSettled([
      c.budget.allocate(c.p, 700, expected),
      c.budget.allocate(c.p, 700, expected),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(poolBalance(await c.db.snapshot()), 300);
    await c.budget.adjust(c.p, -500, "補正", await revision(c.db));
    assert.equal(poolBalance(await c.db.snapshot()), -200);
    await assert.rejects(
      c.budget.setOpening(100, await revision(c.db)),
      /調整/,
    );
    assert.equal(poolHistory(await c.db.snapshot())[0].adjustment, -500);
  }));
test("period change creates forward transition without moving old data", () =>
  setup(async (c) => {
    await expense(c, 100);
    await assert.rejects(
      c.budget.changePeriodStart(c.p, 25, await revision(c.db)),
      /締め/,
    );
    await c.budget.close(c.p, await revision(c.db));
    const old = (await c.db.snapshot()).periods[0];
    await c.budget.changePeriodStart(c.p, 25, await revision(c.db));
    const s = await c.db.snapshot();
    assert.deepEqual(
      s.periods.find((p) => p.id === old.id),
      old,
    );
    assert.deepEqual(
      sortedPeriods(s).map((p) => [p.startDate, p.endDate, p.kind]),
      [
        ["2026-10-01", "2026-10-31", "normal"],
        ["2026-11-01", "2026-11-24", "transition"],
        ["2026-11-25", "2026-12-24", "normal"],
      ],
    );
    assert.equal(s.transactions[0].periodId, old.id);
    assert.equal(
      s.periodBudgets.filter((b) => b.periodId !== old.id).length,
      0,
    );
  }));
test("reverse period change joins at month end; impossible changes leave data intact", () =>
  setup(async (c) => {
    await c.budget.close(c.p, await revision(c.db));
    await c.budget.changePeriodStart(c.p, 25, await revision(c.db));
    let s = await c.db.snapshot(),
      last = sortedPeriods(s).at(-1);
    await c.budget.close(last.id, await revision(c.db));
    await c.budget.changePeriodStart(last.id, 1, await revision(c.db));
    s = await c.db.snapshot();
    assert.deepEqual(
      sortedPeriods(s)
        .slice(-2)
        .map((p) => [p.startDate, p.endDate, p.kind]),
      [
        ["2026-12-25", "2026-12-31", "transition"],
        ["2027-01-01", "2027-01-31", "normal"],
      ],
    );
    const before = await c.db.snapshot();
    await assert.rejects(
      c.budget.changePeriodStart(c.p, 31, await revision(c.db)),
    );
    assert.deepEqual(await c.db.snapshot(), before);
  }));
test("closing 0 is recorded once and budget edits reopen no extra periods", () =>
  setup(async (c) => {
    await c.budget.close(c.p, await revision(c.db));
    let s = await c.db.snapshot();
    assert.equal(s.closingRevisions.length, 1);
    assert.equal(s.carryoverEntries.length, 1);
    await c.budget.save(c.p, 500, [], await revision(c.db));
    s = await c.db.snapshot();
    assert.equal(s.periodClosings[0].settlementTotal, 500);
    assert.equal(s.closingRevisions.length, 2);
    assert.equal(s.periods.length, 1);
    await c.budget.close(c.p, await revision(c.db));
    assert.equal((await c.db.snapshot()).closingRevisions.length, 2);
  }));
