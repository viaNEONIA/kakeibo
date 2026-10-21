import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { openDatabase } from "../js/db.js";
import { stateOf, uuid } from "../js/schema.js";
import { Ledger } from "../js/domain.js";
import { BudgetLedger, periodFigures } from "../js/budget.js";
import { Recurring, recurringMonth, scheduledDate } from "../js/recurring.js";
import { transactionsCsv, poolCsv, csvCell } from "../js/csv.js";
import { FamilySharing } from "../js/share.js";
const rev = async (d) => stateOf(await d.snapshot()).datasetRevision;
async function device() {
  globalThis.indexedDB = new IDBFactory();
  return openDatabase();
}
async function fixture(fn) {
  const db = await device(),
    ledger = new Ledger(db),
    b = new BudgetLedger(db),
    r = new Recurring(db);
  try {
    const expense = (
        await ledger.saveCategory(
          { type: "expense", name: "食費" },
          undefined,
          await rev(db),
        )
      ).resultIds[0],
      income = (
        await ledger.saveCategory(
          { type: "income", name: "給与" },
          undefined,
          await rev(db),
        )
      ).resultIds[0];
    const p = (await b.select("2026-02-01", await rev(db))).resultIds[0];
    const input = {
      type: "expense",
      name: "定期",
      amount: 100,
      categoryId: expense,
      dayOfMonth: 31,
      activeFrom: "2026-01",
      activeUntil: null,
      enabled: true,
    };
    const save = async (x) =>
      (
        await r.save(
          { ...input, ...x },
          x?.id
            ? (await db.snapshot()).recurringRules.find((q) => q.id === x.id)
                .revision
            : undefined,
          await rev(db),
        )
      ).resultIds[0];
    await fn({ db, ledger, b, r, p, expense, income, input, save });
  } finally {
    db.close();
  }
}
test("calendar day corrections cover leap, short month and century boundaries", () => {
  for (const [m, d] of [
    ["2026-02", "2026-02-28"],
    ["2024-02", "2024-02-29"],
    ["2100-02", "2100-02-28"],
    ["2000-02", "2000-02-29"],
    ["2026-04", "2026-04-30"],
  ])
    assert.equal(scheduledDate(m, 31), d);
  for (const m of ["2026-13", "0000-01", "2026-1", "garbage"])
    assert.throws(() => scheduledDate(m, 31));
});
test("income and expense are pure plans until manual single confirmation; income never adds budget", () =>
  fixture(async ({ db, b, r, p, income, save }) => {
    const a = await save(),
      i = await save({
        type: "income",
        name: "給与",
        categoryId: income,
        amount: 2000,
      });
    await b.save(p, 1000, [], await rev(db));
    const before = await db.snapshot();
    assert.equal(recurringMonth(before, "2026-02").length, 2);
    assert.equal(before.transactions.length, 0);
    assert.equal(before.recurringOccurrences.length, 0);
    await r.confirm(a, "2026-02", await rev(db));
    await r.confirm(a, "2026-02", await rev(db));
    await r.confirm(i, "2026-02", await rev(db));
    const s = await db.snapshot();
    assert.equal(s.transactions.length, 2);
    assert.equal(s.recurringOccurrences.length, 2);
    assert(s.transactions.every((t) => t.date === "2026-02-28"));
    const f = periodFigures(s, p);
    assert.equal(f.base, 1000);
    assert.equal(f.expense, 100);
    assert.equal(f.income, 2000);
  }));
test("rule edits do not rewrite confirmed snapshots; deletion remains voided and cannot resurrect", () =>
  fixture(async ({ db, ledger, r, save }) => {
    const id = await save();
    await r.confirm(id, "2026-02", await rev(db));
    let s = await db.snapshot();
    const original = structuredClone(s.transactions[0]);
    await save({ id, amount: 999, name: "変更後", dayOfMonth: 1 });
    s = await db.snapshot();
    assert.deepEqual(s.transactions[0], original);
    assert.equal(s.recurringOccurrences[0].snapshot.amount, 100);
    await ledger.remove(original.id, original.revision, await rev(db));
    await assert.rejects(
      r.confirm(id, "2026-02", await rev(db)),
      /再確定できません/,
    );
    assert.equal((await db.snapshot()).transactions.length, 0);
    assert.equal(
      recurringMonth(await db.snapshot(), "2026-02")[0].status,
      "voided",
    );
  }));
test("disabled rules, end month, invalid amounts and stale revisions do not partly save", () =>
  fixture(async ({ db, r, save, input }) => {
    const id = await save({ activeUntil: "2026-02" });
    assert.equal(recurringMonth(await db.snapshot(), "2026-03").length, 0);
    await save({ id, enabled: false });
    const before = await db.snapshot();
    assert.equal(recurringMonth(before, "2026-02").length, 0);
    await assert.rejects(r.confirm(id, "2026-02", await rev(db)));
    for (const patch of [
      { amount: 0 },
      { amount: 1.2 },
      { amount: 1000000000 },
      { dayOfMonth: 32 },
      { activeUntil: "2025-12" },
      { categoryId: "missing" },
    ])
      await assert.rejects(
        r.save({ ...input, ...patch }, undefined, await rev(db)),
      );
    await assert.rejects(
      r.save({ ...input, id }, 1, await rev(db)),
      /変更されています/,
    );
    assert.deepEqual(await db.snapshot(), before);
  }));
test("existing pending snapshot is preserved; confirmation rollback is atomic and retry succeeds", () =>
  fixture(async ({ db, r, save }) => {
    const id = await save();
    const o = recurringMonth(await db.snapshot(), "2026-02")[0];
    delete o.eligible;
    o.id = uuid();
    await db.command(
      "legacy-pending-fixture",
      {},
      (s) => {
        s.recurringOccurrences.push(o);
        return [];
      },
      { expectedRevision: await rev(db) },
    );
    await save({ id, amount: 999, dayOfMonth: 1 });
    const before = await db.snapshot(),
      put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "transactions") throw Error("fixture write failure");
      return put.apply(this, args);
    };
    try {
      await assert.rejects(
        r.confirm(id, "2026-02", await rev(db)),
        /fixture write/,
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert.deepEqual(await db.snapshot(), before);
    await r.confirm(id, "2026-02", await rev(db));
    const s = await db.snapshot();
    assert.equal(s.transactions[0].amount, 100);
    assert.equal(s.transactions[0].date, "2026-02-28");
  }));
test("calendar schedule maps to changed accounting period and closed expense confirmation re-settles once", () =>
  fixture(async ({ db, b, r, p, save }) => {
    const id = await save();
    await b.save(p, 500, [], await rev(db));
    await b.close(p, await rev(db));
    await r.confirm(id, "2026-02", await rev(db));
    const s = await db.snapshot();
    assert.equal(
      s.periodClosings.find((c) => c.periodId === p).settlementTotal,
      400,
    );
    assert.equal(s.closingRevisions.length, 2);
    await r.confirm(id, "2026-02", await rev(db));
    assert.equal((await db.snapshot()).closingRevisions.length, 2);
    await b.changePeriodStart(p, 25, await rev(db));
    await r.confirm(id, "2026-03", await rev(db));
    const after = await db.snapshot(),
      t = after.transactions.find((t) => t.date === "2026-03-31"),
      period = after.periods.find((p) => p.id === t.periodId);
    assert.equal(period.labelMonth, "2026-04");
  }));
test("parent confirmations survive child exchange, parent round trip and backup without duplication", () =>
  fixture(async ({ db, r, save }) => {
    const family = new FamilySharing(db);
    await family.setup("parent", await rev(db));
    const id = (await family.register("child", await rev(db))).resultIds[0];
    const child = await device();
    try {
      const cf = new FamilySharing(child);
      await cf.join(await family.export(id), await rev(child));
      const rule = await save();
      await r.confirm(rule, "2026-02", await rev(db));
      await cf.import(await cf.preview(await family.export()));
      assert.equal((await child.snapshot()).transactions.length, 1);
      await assert.rejects(
        new Recurring(child).confirm(rule, "2026-03", await rev(child)),
        /親端末専用/,
      );
      await family.import(await family.preview(await cf.export()));
      assert.equal((await db.snapshot()).transactions.length, 1);
      const backup = await db.backup();
      await db.restore(backup, await rev(db));
      assert.equal(
        (await db.snapshot()).recurringOccurrences[0].status,
        "confirmed",
      );
    } finally {
      child.close();
    }
  }));
// Independent small RFC-4180 reader for asserting round trips including quoted newlines.
function parse(csv) {
  const rows = [],
    row = [];
  let text = "",
    quoted = false;
  csv = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        text += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\r")) {
      row.push(text);
      text = "";
      if (c === "\r") {
        rows.push([...row]);
        row.length = 0;
        i++;
      }
    } else text += c;
  }
  return rows;
}
test("CSV round trip escapes quotes/newlines and neutralizes formula text while amounts stay numeric", () =>
  fixture(async ({ db, ledger, expense }) => {
    await ledger.add(
      {
        type: "refund",
        date: "2026-02-10",
        categoryId: expense,
        amount: 123,
        name: '=HYPERLINK("x")',
        memo: '引用,"二重"\n改行',
      },
      await rev(db),
    );
    const before = await db.snapshot(),
      csv = transactionsCsv(before),
      rows = parse(csv);
    assert(csv.startsWith("\uFEFF"));
    assert.equal(rows.length, 2);
    assert.equal(rows[1][2], "返金");
    assert.equal(rows[1][4], '\'=HYPERLINK("x")');
    assert.equal(rows[1][5], "123");
    assert.equal(rows[1][6], '引用,"二重"\n改行');
    assert.equal(rows[1][8], "2026-02-01");
    assert(csv.includes(",123,"));
    for (const s of ["=1", " +1", "-1", "@SUM(1)", "\t=1", "\r=1", "\n=1"])
      assert(csvCell(s).startsWith("\"'"));
    assert.equal(csvCell(-1), "-1");
    assert.deepEqual(await db.snapshot(), before);
  }));
test("separate pool CSV contains actual settlement, goal, unsettled and transition labels", () =>
  fixture(async ({ db, b, p }) => {
    const { Goals } = await import("../js/goals.js");
    await new Goals(db).set(p, 1000, await rev(db));
    await b.adjust(p, -200, "negative", await rev(db));
    const rows = parse(poolCsv(await db.snapshot()));
    assert.equal(rows[1][6], "-200");
    assert.equal(rows[1][7], "200");
    assert.equal(rows[1][8], "1000");
    assert.equal(rows[1][9], "2026-02-01");
    await b.close(p, await rev(db));
    await b.changePeriodStart(p, 25, await rev(db));
    assert(
      parse(poolCsv(await db.snapshot())).some((r) => r[11] === "移行期間"),
    );
  }));
