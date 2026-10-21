import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { openDatabase } from "../js/db.js";
import { Ledger } from "../js/domain.js";
import { BudgetLedger, periodFigures } from "../js/budget.js";
import { Recurring } from "../js/recurring.js";
import { recurringPreview } from "../js/recurring-preview.js";
import { stateOf } from "../js/schema.js";
import { FamilySharing } from "../js/share.js";
const rev = async (d) => stateOf(await d.snapshot()).datasetRevision;
async function device() {
  globalThis.indexedDB = new IDBFactory();
  return openDatabase();
}
async function fixture(fn) {
  const db = await device(),
    b = new BudgetLedger(db),
    l = new Ledger(db),
    r = new Recurring(db);
  try {
    const food = (
        await l.saveCategory(
          { type: "expense", name: "food" },
          undefined,
          await rev(db),
        )
      ).resultIds[0],
      income = (
        await l.saveCategory(
          { type: "income", name: "income" },
          undefined,
          await rev(db),
        )
      ).resultIds[0];
    const old = (await b.select("2026-10-20", await rev(db))).resultIds[0];
    await b.close(old, await rev(db));
    await b.changePeriodStart(old, 25, await rev(db));
    const p = (await b.select("2026-11-25", await rev(db))).resultIds[0];
    await b.save(p, 1000, [{ categoryId: food, amount: 1000 }], await rev(db));
    const make = async (day, amount, type = "expense") =>
      (
        await r.save(
          {
            name: "plan" + day,
            type,
            dayOfMonth: day,
            amount,
            categoryId: type === "expense" ? food : income,
            activeFrom: "2026-01",
            activeUntil: null,
            enabled: true,
          },
          undefined,
          await rev(db),
        )
      ).resultIds[0];
    const a = await make(31, 300),
      c = await make(15, 150),
      i = await make(31, 500, "income");
    await fn({ db, b, l, r, p, food, income, a, c, i });
  } finally {
    db.close();
  }
}
test("two-month accounting period includes corrected dates only, separates income and is read-only", () =>
  fixture(async ({ db, p, food, income }) => {
    const before = await db.snapshot(),
      v = recurringPreview(before, p);
    assert.equal(v.expense, 450);
    assert.equal(v.income, 500);
    assert.equal(v.byCategory[food], 450);
    assert.equal(v.byCategory[income], 500);
    assert.deepEqual(v.rows.map((o) => o.scheduledDate).sort(), [
      "2026-11-30",
      "2026-11-30",
      "2026-12-15",
    ]);
    assert.equal(recurringPreview(before, "missing"), null);
    recurringPreview(before, p);
    assert.deepEqual(await db.snapshot(), before);
    assert.deepEqual(before, await db.snapshot());
  }));
test("confirmation moves plan into actual without double counting; deletion never returns it to plans", () =>
  fixture(async ({ db, r, l, p, a }) => {
    await r.confirm(a, "2026-11", await rev(db));
    let s = await db.snapshot(),
      plan = recurringPreview(s, p),
      f = periodFigures(s, p);
    assert.equal(plan.expense, 150);
    assert.equal(f.expense, 300);
    assert.equal(f.remaining - plan.expense, 550);
    assert.equal(f.balance, 0);
    const t = s.transactions[0];
    await l.remove(t.id, t.revision, await rev(db));
    s = await db.snapshot();
    assert.equal(recurringPreview(s, p).expense, 150);
    assert.equal(periodFigures(s, p).expense, 0);
  }));
test("disabled rules, inactive items and outside active month are excluded", () =>
  fixture(async ({ db, r, l, p, a, c, food }) => {
    let s = await db.snapshot(),
      row = s.recurringRules.find((q) => q.id === a);
    await r.save({ ...row, enabled: false }, row.revision, await rev(db));
    s = await db.snapshot();
    row = s.recurringRules.find((q) => q.id === c);
    await r.save(
      { ...row, activeUntil: "2026-11" },
      row.revision,
      await rev(db),
    );
    assert.equal(recurringPreview(await db.snapshot(), p).expense, 0);
    s = await db.snapshot();
    row = s.recurringRules.find((q) => q.id === a);
    await r.save({ ...row, enabled: true }, row.revision, await rev(db));
    s = await db.snapshot();
    assert.equal(recurringPreview(s, p).expense, 300);
    const cat = s.categories.find((q) => q.id === food);
    await l.saveCategory(
      { ...cat, active: false },
      cat.revision,
      await rev(db),
    );
    assert.equal(recurringPreview(await db.snapshot(), p).income, 500);
    assert.equal(recurringPreview(await db.snapshot(), p).expense, 0);
  }));
test("child uses received parent plans until a new parent result is imported", () =>
  fixture(async ({ db, r, p, a }) => {
    const f = new FamilySharing(db);
    await f.setup("parent", await rev(db));
    const id = (await f.register("child", await rev(db))).resultIds[0],
      child = await device();
    try {
      const cf = new FamilySharing(child);
      await cf.join(await f.export(id), await rev(child));
      const before = await child.snapshot();
      assert.equal(recurringPreview(before, p).expense, 450);
      assert.equal(recurringPreview(before, p).parentSnapshot, true);
      await r.confirm(a, "2026-11", await rev(db));
      assert.equal(recurringPreview(await child.snapshot(), p).expense, 450);
      await cf.import(await cf.preview(await f.export()));
      const s = await child.snapshot();
      assert.equal(recurringPreview(s, p).expense, 150);
      assert.equal(periodFigures(s, p).expense, 300);
    } finally {
      child.close();
    }
  }));
