import { childBudgetPreview } from "../js/child-preview.js";
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { openDatabase } from "../js/db.js";
import { Ledger } from "../js/domain.js";
import { BudgetLedger, poolBalance } from "../js/budget.js";
import { FamilySharing, exchange } from "../js/share.js";
import { sharing, resolved } from "../js/share-state.js";
import { stateOf } from "../js/schema.js";
import { validateBackup, validateStores } from "../js/validation.js";
const rev = async (d) => stateOf(await d.snapshot()).datasetRevision;
async function device() {
  globalThis.indexedDB = new IDBFactory();
  const db = await openDatabase();
  return db;
}
async function fixture(fn) {
  const p = await device(),
    a = await device(),
    b = await device(),
    f = new FamilySharing(p);
  try {
    const cat = (
      await new Ledger(p).saveCategory(
        { type: "expense", name: "食費" },
        undefined,
        await rev(p),
      )
    ).resultIds[0];
    const row = {
      type: "expense",
      date: "2026-10-20",
      categoryId: cat,
      amount: 100,
      name: "食事",
      memo: "",
    };
    const id = (await new Ledger(p).add(row, await rev(p))).resultIds[0];
    await f.setup("親", await rev(p));
    const aid = (await f.register("子1", await rev(p))).resultIds[0],
      bid = (await f.register("子2", await rev(p))).resultIds[0];
    await new FamilySharing(a).join(await f.export(aid), await rev(a));
    await new FamilySharing(b).join(await f.export(bid), await rev(b));
    await fn({ p, a, b, f, row, id, cat });
  } finally {
    for (const d of [p, a, b]) d.close();
  }
}
async function edit(d, id, amount) {
  const t = (await d.snapshot()).transactions.find((t) => t.id === id);
  await new Ledger(d).edit(id, { ...t, amount }, t.revision, await rev(d));
}
async function remove(d, id) {
  const t = (await d.snapshot()).transactions.find((t) => t.id === id);
  await new Ledger(d).remove(id, t.revision, await rev(d));
}
async function merge(target, source) {
  const f = new FamilySharing(target),
    data = source?.format ? source : await new FamilySharing(source).export();
  const preview = await f.preview(data);
  await f.import(preview);
  return preview.report;
}
test("parent setup and registered child identity; repeated import and round trip do not duplicate", () =>
  fixture(async (c) => {
    const q = sharing(await c.a.snapshot());
    assert.equal(q.members.find((m) => m.id === q.deviceId).order, 1);
    await new Ledger(c.a).add(c.row, await rev(c.a));
    let r = await merge(c.p, c.a);
    assert.equal(r.added, 1);
    assert.equal((await c.p.snapshot()).transactions.length, 2);
    r = await merge(c.p, c.a);
    assert.equal(r.added, 0);
    await merge(c.a, c.p);
    await merge(c.p, c.a);
    assert.equal((await c.p.snapshot()).transactions.length, 2);
  }));
test("parent old unedited copy never defeats child later edit; forwarding retains origin", () =>
  fixture(async (c) => {
    await edit(c.a, c.id, 200);
    await merge(c.p, c.a);
    assert.equal((await c.p.snapshot()).transactions[0].amount, 200);
    const win = resolved(sharing(await c.p.snapshot()))[0].winner;
    assert.equal(win.deviceId, sharing(await c.a.snapshot()).deviceId);
    await edit(c.b, c.id, 300);
    const r = await merge(c.p, c.b);
    assert.equal((await c.p.snapshot()).transactions[0].amount, 200);
    assert.equal(r.conflicts[0].reason, "子の登録順を優先");
  }));
test("concurrent parent edit beats child edit or delete, causal child edit may follow parent", () =>
  fixture(async (c) => {
    await edit(c.p, c.id, 150);
    await remove(c.a, c.id);
    let r = await merge(c.p, c.a);
    assert.equal((await c.p.snapshot()).transactions[0].amount, 150);
    assert.equal(r.conflicts[0].reason, "親の変更を優先");
    await merge(c.a, c.p);
    await edit(c.a, c.id, 170);
    await merge(c.p, c.a);
    assert.equal((await c.p.snapshot()).transactions[0].amount, 170);
  }));
test("deletion tombstone survives stale file and child deletion wins later registered edit", () =>
  fixture(async (c) => {
    const stale = await c.f.export();
    await remove(c.a, c.id);
    await edit(c.b, c.id, 999);
    await merge(c.p, c.b);
    await merge(c.p, c.a);
    assert.equal((await c.p.snapshot()).transactions.length, 0);
    await merge(c.a, c.p);
    await merge(c.a, stale);
    assert.equal((await c.a.snapshot()).transactions.length, 0);
  }));
test("child-to-child merge order converges, including parent forwarded child events", () =>
  fixture(async (c) => {
    await edit(c.a, c.id, 200);
    await edit(c.b, c.id, 300);
    const fa = await new FamilySharing(c.a).export(),
      fb = await new FamilySharing(c.b).export();
    await merge(c.a, fb);
    await merge(c.b, fa);
    assert.equal((await c.a.snapshot()).transactions[0].amount, 200);
    assert.equal((await c.b.snapshot()).transactions[0].amount, 200);
    await merge(c.p, c.b);
    await merge(c.a, c.p);
    assert.equal((await c.a.snapshot()).transactions[0].amount, 200);
  }));
test("only parent settles; late child edit is pending until parent import and repeated import has no delta", () =>
  fixture(async (c) => {
    const budget = new BudgetLedger(c.p),
      pid = (await c.p.snapshot()).periods[0].id;
    await budget.save(pid, 1000, [], await rev(c.p));
    await budget.close(pid, await rev(c.p));
    await merge(c.a, c.p);
    const old = poolBalance(await c.a.snapshot());
    await edit(c.a, c.id, 400);
    assert.equal(poolBalance(await c.a.snapshot()), old);
    await assert.rejects(
      new BudgetLedger(c.a).close(pid, await rev(c.a)),
      /親端末/,
    );
    await assert.rejects(
      new BudgetLedger(c.a).adjust(pid, 100, "", await rev(c.a)),
      /親端末/,
    );
    await assert.rejects(
      new Ledger(c.a).saveCategory(
        { type: "expense", name: "不可" },
        undefined,
        await rev(c.a),
      ),
      /親端末/,
    );
    await merge(c.p, c.a);
    assert.equal(poolBalance(await c.p.snapshot()), 600);
    const n = (await c.p.snapshot()).carryoverEntries.length;
    await merge(c.p, c.a);
    assert.equal((await c.p.snapshot()).carryoverEntries.length, n);
    await merge(c.a, c.p);
    assert.equal(poolBalance(await c.a.snapshot()), 600);
    validateStores(await c.a.snapshot());
  }));
test("independent future period UUIDs remap to parent dates without duplicate periods", () =>
  fixture(async (c) => {
    await new Ledger(c.a).add({ ...c.row, date: "2026-11-20" }, await rev(c.a));
    await new Ledger(c.b).add({ ...c.row, date: "2026-11-20" }, await rev(c.b));
    await merge(c.p, c.a);
    await merge(c.p, c.b);
    const s = await c.p.snapshot();
    assert.equal(s.periods.length, 2);
    assert.equal(
      s.transactions.filter((t) => t.date === "2026-11-20").length,
      2,
    );
    validateStores(s);
  }));
test("stale preview, other book and malformed DAG leave stores unchanged", () =>
  fixture(async (c) => {
    const f = new FamilySharing(c.p),
      preview = await f.preview(await new FamilySharing(c.a).export());
    await edit(c.p, c.id, 200);
    await assert.rejects(f.import(preview), /変更/);
    const before = await c.p.snapshot(),
      data = await new FamilySharing(c.a).export();
    data.bookId = crypto.randomUUID();
    await assert.rejects(f.preview(data), /別の家計簿/);
    data.bookId = sharing(before).bookId;
    data.events[0].parents = [crypto.randomUUID()];
    await assert.rejects(f.preview(data), /参照|循環|欠落/);
    assert.deepEqual(await c.p.snapshot(), before);
  }));
test("shared backup version2 restores while preserving own device; old nonshared restore is rejected", () =>
  fixture(async (c) => {
    const backup = await c.p.backup();
    assert.equal(backup.backupFormatVersion, 2);
    validateBackup(backup);
    const own = sharing(await c.a.snapshot()).deviceId;
    await c.a.restore(backup, await rev(c.a));
    assert.equal(sharing(await c.a.snapshot()).deviceId, own);
    const d = await device();
    try {
      const old = await d.backup();
      assert.equal(old.backupFormatVersion, 1);
      await assert.rejects(c.a.restore(old, await rev(c.a)), /共有中/);
      await assert.rejects(d.restore(backup, await rev(d)), /子参加/);
    } finally {
      d.close();
    }
  }));
test("legacy DB version1 migrates in place and closes old connection", async () => {
  globalThis.indexedDB = new IDBFactory();
  const { STORES, DB_NAME, initialStores } = await import("../js/schema.js");
  const old = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const [name, schema] of Object.entries(STORES)) {
        const store = r.result.createObjectStore(name, { keyPath: schema.key });
        for (const [key, raw] of Object.entries(schema.indexes || {}))
          store.createIndex(key, raw.key || raw, {
            unique: raw.unique === true,
          });
      }
      const s = initialStores();
      s.meta.find((r) => r.key === "schemaInfo").value.dbSchemaVersion = 1;
      for (const [name, rows] of Object.entries(s))
        for (const row of rows) r.transaction.objectStore(name).put(row);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  let closed = false;
  old.onversionchange = () => {
    closed = true;
    old.close();
  };
  const db = await openDatabase();
  try {
    assert(closed);
    assert.equal(
      (await db.snapshot()).meta.find((r) => r.key === "schemaInfo").value
        .dbSchemaVersion,
      2,
    );
    assert.equal((await db.snapshot()).carryoverEntries.length, 1);
  } finally {
    db.close();
  }
});
test("legacy JSON version1 is upgraded without mutating source or losing business records", async () => {
  const d = await device();
  try {
    const b = await d.backup();
    b.dbSchemaVersion = 1;
    b.stores.meta.find((r) => r.key === "schemaInfo").value.dbSchemaVersion = 1;
    const original = structuredClone(b),
      migrated = validateBackup(b);
    assert.deepEqual(b, original);
    assert.equal(migrated.dbSchemaVersion, 2);
    await d.restore(b, await rev(d));
    assert.equal((await d.snapshot()).carryoverEntries.length, 1);
  } finally {
    d.close();
  }
});

test("two prepared imports cannot both commit against the same revision", () =>
  fixture(async (c) => {
    const f = new FamilySharing(c.p),
      data = await new FamilySharing(c.a).export(),
      one = await f.preview(data),
      two = await f.preview(data),
      before = await rev(c.p);
    await f.import(one);
    assert.equal(await rev(c.p), before + 1);
    await assert.rejects(f.import(two), /変更/);
  }));
test("duplicating a child invitation cannot silently choose between two same-ID writers", () =>
  fixture(async (c) => {
    const q = sharing(await c.a.snapshot()),
      duplicate = await device();
    try {
      await new FamilySharing(duplicate).join(
        await c.f.export(q.deviceId),
        await rev(duplicate),
      );
      await edit(c.a, c.id, 200);
      await edit(duplicate, c.id, 300);
      await merge(c.p, c.a);
      const before = await c.p.snapshot();
      await assert.rejects(merge(c.p, duplicate), /同じ端末ID/);
      assert.deepEqual(await c.p.snapshot(), before);
    } finally {
      duplicate.close();
    }
  }));

test("ordinary shared JSON backup can be merged without performing full replacement", () =>
  fixture(async (c) => {
    await new Ledger(c.a).add({ ...c.row, amount: 222 }, await rev(c.a));
    const file = await c.a.backup(),
      q = sharing(await c.p.snapshot()),
      f = new FamilySharing(c.p);
    await f.import(await f.preview(file));
    assert.equal((await c.p.snapshot()).transactions.length, 2);
    assert.equal(sharing(await c.p.snapshot()).deviceId, q.deviceId);
  }));

test("child provisional budget stays pending until parent acknowledgement and preserves later edits", () =>
  fixture(async (c) => {
    const pid = (await c.a.snapshot()).periods[0].id,
      initial = await c.a.snapshot();
    assert.equal(childBudgetPreview(initial, pid).pendingCount, 0);
    await new Ledger(c.a).add({ ...c.row, amount: 200 }, await rev(c.a));
    let s = await c.a.snapshot(),
      v = childBudgetPreview(s, pid);
    assert.equal(v.local.expense, 300);
    assert.equal(v.confirmed.expense, 100);
    assert.equal(v.pendingCount, 1);
    assert.equal(poolBalance(s), poolBalance(initial));
    await merge(c.p, c.a);
    assert.equal(childBudgetPreview(await c.a.snapshot(), pid).pendingCount, 1);
    const ack = await c.f.export();
    await edit(c.a, c.id, 180);
    await merge(c.a, ack);
    s = await c.a.snapshot();
    v = childBudgetPreview(s, pid);
    assert.equal(v.local.expense, 380);
    assert.equal(v.confirmed.expense, 300);
    assert.equal(v.pendingCount, 1);
    await merge(c.p, c.a);
    await merge(c.a, c.p);
    v = childBudgetPreview(await c.a.snapshot(), pid);
    assert.equal(v.pendingCount, 0);
    assert.equal(v.provisional, false);
    assert.equal(v.local.expense, 380);
    assert.equal(v.confirmed.expense, 380);
  }));
test("child preview handles refunds, income, deletion and moves; parent priority updates preview", () =>
  fixture(async (c) => {
    const incomeCat = (
      await new Ledger(c.p).saveCategory(
        { type: "income", name: "給与" },
        undefined,
        await rev(c.p),
      )
    ).resultIds[0];
    await merge(c.a, c.p);
    let s = await c.a.snapshot(),
      pid = s.periods[0].id;
    await new Ledger(c.a).add(
      { ...c.row, type: "income", categoryId: incomeCat, amount: 500 },
      await rev(c.a),
    );
    await new Ledger(c.a).add(
      { ...c.row, type: "refund", amount: 30 },
      await rev(c.a),
    );
    await remove(c.a, c.id);
    let v = childBudgetPreview(await c.a.snapshot(), pid);
    assert.equal(v.local.income, 500);
    assert.equal(v.local.expense, -30);
    assert.equal(v.local.refund, 30);
    assert.equal(v.pendingCount, 3);
    await edit(c.p, c.id, 150);
    await merge(c.p, c.a);
    await merge(c.a, c.p);
    v = childBudgetPreview(await c.a.snapshot(), pid);
    assert.equal(v.pendingCount, 0);
    assert.equal(v.local.expense, 120);
    assert.equal(v.confirmed.expense, 120);
    const t = (await c.a.snapshot()).transactions.find((t) => t.id === c.id);
    await new Ledger(c.a).edit(
      t.id,
      { ...t, date: "2026-11-20" },
      t.revision,
      await rev(c.a),
    );
    s = await c.a.snapshot();
    assert.equal(childBudgetPreview(s, pid).pendingCount, 1);
    const next = s.periods.find((p) => p.startDate === "2026-11-01");
    assert.equal(childBudgetPreview(s, next.id).pendingCount, 1);
    assert.equal(childBudgetPreview(s, next.id).local.expense, 150);
  }));
test("child-to-child forwarding carries only parent acknowledgement; legacy child snapshots remain unknown", () =>
  fixture(async (c) => {
    const pid = (await c.a.snapshot()).periods[0].id;
    await edit(c.a, c.id, 250);
    await merge(c.b, c.a);
    assert.equal(childBudgetPreview(await c.b.snapshot(), pid).pendingCount, 1);
    await merge(c.p, c.a);
    await merge(c.a, c.p);
    await merge(c.b, c.a);
    assert.equal(childBudgetPreview(await c.b.snapshot(), pid).pendingCount, 0);
    const data = await new FamilySharing(c.a).export();
    delete data.parentEventIds;
    await edit(c.p, c.id, 300);
    await merge(c.a, c.p);
    const newer = await new FamilySharing(c.a).export();
    delete newer.parentEventIds;
    await merge(c.b, newer);
    assert.equal(childBudgetPreview(await c.b.snapshot(), pid).unknown, true);
    const fromParent = await c.f.export();
    delete fromParent.parentEventIds;
    await merge(c.b, fromParent);
    assert.equal(childBudgetPreview(await c.b.snapshot(), pid).unknown, false);
    assert.equal(childBudgetPreview(await c.b.snapshot(), pid).pendingCount, 0);
  }));

test("partial acknowledgement of the same parent version does not undo known confirmations", () =>
  fixture(async (c) => {
    const pid = (await c.a.snapshot()).periods[0].id,
      file = await new FamilySharing(c.b).export();
    file.parentEventIds = [];
    await merge(c.a, file);
    assert.equal(childBudgetPreview(await c.a.snapshot(), pid).pendingCount, 0);
  }));

test("explicit parent recovery restores original identity and financial records, then accepts existing children once", () =>
  fixture(async (c) => {
    const budget = new BudgetLedger(c.p),
      pid = (await c.p.snapshot()).periods[0].id;
    await budget.save(pid, 1000, [], await rev(c.p));
    await budget.close(pid, await rev(c.p));
    const data = await c.p.backup(),
      original = structuredClone(data),
      fresh = await device();
    try {
      await new BudgetLedger(fresh).select("2026-10-20", await rev(fresh));
      await fresh.restore(data, await rev(fresh), { recoverParent: true });
      const restored = await fresh.snapshot(),
        q = sharing(restored),
        source = sharing(data.stores);
      assert.equal(q.bookId, source.bookId);
      assert.equal(q.parentId, source.parentId);
      assert.equal(q.deviceId, source.deviceId);
      assert.deepEqual(q, source);
      for (const name of Object.keys(data.stores).filter(
        (n) => !["meta", "operationReceipts"].includes(n),
      ))
        assert.deepEqual(restored[name], data.stores[name]);
      assert.equal(
        restored.operationReceipts.length,
        data.stores.operationReceipts.length + 1,
      );
      assert.equal(stateOf(restored).parentRecovery.parentId, q.parentId);
      assert.notEqual(stateOf(restored).datasetId, data.sourceDatasetId);
      assert.deepEqual(data, original);
      await new Ledger(c.a).add({ ...c.row, amount: 50 }, await rev(c.a));
      await merge(fresh, c.a);
      assert.equal(poolBalance(await fresh.snapshot()), 850);
      const count = (await fresh.snapshot()).carryoverEntries.length;
      await merge(fresh, c.a);
      assert.equal((await fresh.snapshot()).carryoverEntries.length, count);
      await merge(c.a, fresh);
      assert.equal(poolBalance(await c.a.snapshot()), 850);
    } finally {
      fresh.close();
    }
  }));
test("fresh recovery requires explicit opt-in and a parent-origin backup", () =>
  fixture(async (c) => {
    const d = await device(),
      data = await c.p.backup();
    try {
      const before = await d.snapshot();
      await assert.rejects(d.restore(data, await rev(d)), /共有中/);
      await assert.rejects(
        d.restore(await c.a.backup(), await rev(d), { recoverParent: true }),
        /親の復旧/,
      );
      assert.deepEqual(await d.snapshot(), before);
    } finally {
      d.close();
    }
  }));
test("parent recovery rejects existing sharing or business data, without changing records", () =>
  fixture(async (c) => {
    const data = await c.p.backup();
    for (const scenario of ["category", "opening", "shared"]) {
      const d = await device();
      try {
        if (scenario === "category")
          await new Ledger(d).saveCategory(
            { type: "expense", name: "既存" },
            undefined,
            await rev(d),
          );
        if (scenario === "opening")
          await new BudgetLedger(d).setOpening(1, await rev(d));
        if (scenario === "shared") {
          await new FamilySharing(d).setup("既存の親", await rev(d));
          await new FamilySharing(d).register("登録済み", await rev(d));
        }
        const before = await d.snapshot();
        await assert.rejects(
          d.restore(data, await rev(d), { recoverParent: true }),
          /親の復旧/,
        );
        assert.deepEqual(await d.snapshot(), before);
      } finally {
        d.close();
      }
    }
    await assert.rejects(
      c.a.restore(data, await rev(c.a), { recoverParent: true }),
      /親の復旧/,
    );
  }));
test("parent recovery validates current revision, rolls back injected write failure and invalidates old generation", () =>
  fixture(async (c) => {
    const data = await c.p.backup(),
      d = await device(),
      stale = await openDatabase();
    try {
      const before = await d.snapshot(),
        generation = d.generation,
        put = IDBObjectStore.prototype.put;
      let n = 0;
      IDBObjectStore.prototype.put = function (...args) {
        if (++n === 4) throw Error("recovery write failure");
        return put.apply(this, args);
      };
      try {
        await assert.rejects(
          d.restore(data, await rev(d), { recoverParent: true }),
          /recovery write/,
        );
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      assert.deepEqual(await d.snapshot(), before);
      assert.equal(d.generation, generation);
      const old = await rev(d);
      await d.savePreferences({ warningPercent: 75 }, old);
      await assert.rejects(
        d.restore(data, old, { recoverParent: true }),
        /確認後/,
      );
      await d.restore(data, await rev(d), { recoverParent: true });
      await assert.rejects(
        stale.savePreferences({ warningPercent: 60 }, await rev(d)),
        /復元/,
      );
    } finally {
      stale.close();
      d.close();
    }
  }));

test("an unused parent setup without business data or children can be replaced only by explicit recovery", () =>
  fixture(async (c) => {
    const d = await device(),
      data = await c.p.backup();
    try {
      await new FamilySharing(d).setup("誤って作成した未使用親", await rev(d));
      await assert.rejects(d.restore(data, await rev(d)), /共有中/);
      await d.restore(data, await rev(d), { recoverParent: true });
      assert.equal(
        sharing(await d.snapshot()).deviceId,
        sharing(data.stores).parentId,
      );
    } finally {
      d.close();
    }
  }));
test("recovering an old parent backup does not silently accept a newer parent snapshot from a child", () =>
  fixture(async (c) => {
    const data = await c.p.backup();
    await c.p.savePreferences({ warningPercent: 79 }, await rev(c.p));
    await merge(c.a, c.p);
    const recovered = await device();
    try {
      await recovered.restore(data, await rev(recovered), {
        recoverParent: true,
      });
      const before = await recovered.snapshot();
      await assert.rejects(merge(recovered, c.a), /親より新しい/);
      assert.deepEqual(await recovered.snapshot(), before);
    } finally {
      recovered.close();
    }
  }));
