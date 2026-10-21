import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { openDatabase } from "../js/db.js";
import {
  Goals,
  goalAt,
  goalFigures,
  pendingGoal,
  recordGoalAchievement,
} from "../js/goals.js";
import { BudgetLedger, poolBalance, poolHistory } from "../js/budget.js";
import { stateOf } from "../js/schema.js";
import { today, plusDays } from "../js/domain.js";
import { FamilySharing } from "../js/share.js";
const rev = async (d) => stateOf(await d.snapshot()).datasetRevision;
async function device() {
  globalThis.indexedDB = new IDBFactory();
  return openDatabase();
}
async function fixture(fn) {
  const db = await device(),
    b = new BudgetLedger(db),
    g = new Goals(db);
  try {
    const p = (await b.select(today(), await rev(db))).resultIds[0];
    await fn({ db, b, g, p });
  } finally {
    db.close();
  }
}
test("goal setting, change, separate release, future effectiveness and same-period history", () =>
  fixture(async ({ db, b, g, p }) => {
    let s = await db.snapshot();
    assert.equal(goalFigures(s, p).target, null);
    const future = (
      await b.select(
        plusDays(s.periods.find((r) => r.id === p).endDate, 1),
        await rev(db),
      )
    ).resultIds[0];
    await g.set(p, 1000, await rev(db));
    await g.set(p, 1200, await rev(db));
    await g.set(future, null, await rev(db));
    s = await db.snapshot();
    assert.equal(goalAt(s, p).targetAmount, 1200);
    assert.equal(goalAt(s, future).targetAmount, null);
    assert.equal(s.goalHistory.length, 3);
    assert.equal(goalFigures(s, p, -1000).rate, (-1000 / 1200) * 100);
    assert.equal(goalFigures(s, p, -1000).shortfall, 2200n);
    assert.equal(goalFigures(s, p, 2400).rate, 200);
    assert.equal(goalFigures(s, p, 2400).shortfall, 0n);
    assert.equal(goalFigures(s, future).rate, null);
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await assert.rejects(g.set(p, bad, await rev(db)));
    assert.deepEqual(await db.snapshot(), s);
  }));
test("achievement stored atomically once; decrease and regain do not repeat; new setting resets", () =>
  fixture(async ({ db, b, g, p }) => {
    await g.set(p, 100, await rev(db));
    await b.adjust(p, 100, "reach", await rev(db));
    let s = await db.snapshot();
    assert.equal(s.goalNotifications.length, 1);
    assert.equal(s.goalNotifications[0].periodId, p);
    await b.adjust(p, -90, "decrease", await rev(db));
    await b.adjust(p, 100, "regain", await rev(db));
    assert.equal((await db.snapshot()).goalNotifications.length, 1);
    assert.equal(await g.check(), false);
    await g.set(p, 100, await rev(db));
    s = await db.snapshot();
    assert.equal(s.goalNotifications.length, 2);
    const backup = await db.backup();
    await db.restore(backup, await rev(db));
    assert.equal(await g.check(), false);
    assert.equal((await db.snapshot()).goalNotifications.length, 2);
  }));
test("write failure in achievement rolls back pool change and keeps retry possible", () =>
  fixture(async ({ db, b, g, p }) => {
    await g.set(p, 10, await rev(db));
    const before = await db.snapshot(),
      put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "goalNotifications")
        throw Error("injected goal failure");
      return put.apply(this, args);
    };
    try {
      await assert.rejects(b.adjust(p, 10, "reach", await rev(db)), /injected/);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert.deepEqual(await db.snapshot(), before);
    await b.adjust(p, 10, "retry", await rev(db));
    assert.equal((await db.snapshot()).goalNotifications.length, 1);
  }));
test("future goal records no early achievement, activates once at boundary and exact large deficit", () =>
  fixture(async ({ db, b, g, p }) => {
    await b.setOpening(100, await rev(db));
    let s = await db.snapshot();
    const end = s.periods.find((r) => r.id === p).endDate;
    const future = (await b.select(plusDays(end, 1), await rev(db)))
      .resultIds[0];
    await g.set(future, 50, await rev(db));
    s = await db.snapshot();
    assert.equal(s.goalNotifications.length, 0);
    assert.equal(pendingGoal(s), null);
    const hit = pendingGoal(s, plusDays(end, 1));
    assert.equal(hit.goal.targetAmount, 50);
    assert.equal(hit.period.id, future);
    await g.set(p, Number.MAX_SAFE_INTEGER, await rev(db));
    s = await db.snapshot();
    assert.equal(
      goalFigures(s, p, -Number.MAX_SAFE_INTEGER).shortfall,
      18014398509481982n,
    );
  }));
test("historical period IDs and goals survive period-policy transition with same label month", () =>
  fixture(async ({ db, b, g, p }) => {
    await g.set(p, 500, await rev(db));
    await b.close(p, await rev(db));
    await b.changePeriodStart(p, 25, await rev(db));
    const s = await db.snapshot();
    const rows = poolHistory(s);
    assert.equal(goalAt(s, p).targetAmount, 500);
    assert(rows.length >= 2);
    for (const row of rows)
      assert.equal(goalAt(s, row.period.id).targetAmount, 500);
    assert.equal(s.goalHistory[0].effectivePeriodId, p);
  }));
test("parent shares goals and achievement; child cannot edit or independently acknowledge", () =>
  fixture(async ({ db, b, g, p }) => {
    const f = new FamilySharing(db);
    await f.setup("parent", await rev(db));
    const childId = (await f.register("child", await rev(db))).resultIds[0];
    const child = await device();
    try {
      const cf = new FamilySharing(child);
      await cf.join(await f.export(childId), await rev(child));
      await g.set(p, 100, await rev(db));
      await b.adjust(p, 110, "reach", await rev(db));
      await cf.import(await cf.preview(await f.export()));
      let s = await child.snapshot();
      assert(Math.abs(goalFigures(s, p).rate - 110) < 1e-10);
      assert.equal(s.goalNotifications.length, 1);
      await assert.rejects(
        new Goals(child).set(p, 200, await rev(child)),
        /親端末専用/,
      );
      assert.equal(await new Goals(child).check(), false);
      const before = structuredClone(s);
      recordGoalAchievement(s);
      assert.deepEqual(s, before);
    } finally {
      child.close();
    }
  }));
