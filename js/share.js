import { stateOf, uuid, now, STORE_NAMES } from "./schema.js";
import { assert, validateStores, validateBackup } from "./validation.js";
import {
  sharing,
  isChild,
  validateSharing,
  canonical,
  resolved,
  unionEvents,
} from "./share-state.js";
import { ensurePeriod, recalculateClosed } from "./domain.js";
import { poolBalance, periodFigures } from "./budget.js";
const clone = structuredClone;
function plain(s) {
  const out = clone(s);
  delete stateOf(out).sharing;
  return out;
}
function cleanName(n) {
  assert(
    typeof n === "string" && n.trim().length > 0 && n.trim().length <= 80,
    "端末名は1〜80文字で入力してください",
  );
  return n.trim();
}
export function exchange(s, target = null) {
  const q = sharing(s);
  assert(q, "先に家族共有を設定してください");
  validateStores(s);
  if (target)
    assert(
      !isChild(s) && q.members.some((m) => m.id === target && m.order > 0),
      "子の登録を確認してください",
    );
  return {
    format: "kakeibo-family",
    exchangeVersion: 1,
    createdAt: now(),
    bookId: q.bookId,
    senderId: q.deviceId,
    parentId: q.parentId,
    members: clone(q.members),
    masterVersion: q.masterVersion,
    master: isChild(s) ? clone(q.master) : plain(s),
    events: clone(q.events),
    parentEventIds: isChild(s)
      ? clone(q.confirmedEventIds)
      : q.events.map((e) => e.id),
    joinDeviceId: target,
  };
}
export function validateExchange(data) {
  if (data?.format === "kakeibo-pwa") {
    const backup = validateBackup(data);
    assert(sharing(backup.stores), "共有設定前のバックアップは統合できません");
    return validateExchange(exchange(backup.stores));
  }
  assert(
    data?.format === "kakeibo-family" && data.exchangeVersion === 1,
    "未対応の家族共有ファイルです",
  );
  assert(data.master && !sharing(data.master), "親の確定データが不正です");
  validateStores(data.master);
  validateSharing({
    version: 1,
    bookId: data.bookId,
    parentId: data.parentId,
    deviceId: data.senderId,
    members: data.members,
    events: data.events,
    masterVersion: data.masterVersion,
    confirmedEventIds: data.parentEventIds,
  });
  if (data.joinDeviceId)
    assert(
      data.senderId === data.parentId &&
        data.members.some((m) => m.id === data.joinDeviceId && m.order > 0),
      "子参加ファイルが不正です",
    );
  return data;
}
function compatibleMembers(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++)
    assert(canonical(a[i]) === canonical(b[i]), "端末登録順が一致しません");
}
function materialize(s, q) {
  const results = resolved(q);
  s.transactions = [];
  for (const { winner } of results) {
    if (winner.value) {
      const t = clone(winner.value);
      t.periodId = ensurePeriod(s, t.date).id;
      s.transactions.push(t);
    }
  }
  // Recurring-linked records are parent-only in this release.
  for (const o of s.recurringOccurrences) {
    const t = s.transactions.find((t) => t.occurrenceId === o.id);
    if (t) {
      o.status = "confirmed";
      o.transactionId = t.id;
    } else if (o.status === "confirmed") {
      o.status = "voided";
      delete o.transactionId;
    }
  }
  return results;
}
export function mergeState(current, data, operationId) {
  data = validateExchange(data);
  const q = sharing(current);
  assert(
    q && q.bookId === data.bookId && q.parentId === data.parentId,
    "別の家計簿のファイルは統合できません",
  );
  compatibleMembers(q.members, data.members);
  assert(
    q.members.some((m) => m.id === data.senderId) || isChild(current),
    "未登録の端末です",
  );
  if (!isChild(current))
    assert(
      data.masterVersion <= q.masterVersion,
      "親より新しい確定版です。古い親バックアップの復元を確認してください",
    );
  const next = clone(current),
    nq = sharing(next),
    before = new Map(current.transactions.map((t) => [t.id, canonical(t)]));
  if (isChild(current) && data.masterVersion > q.masterVersion) {
    const localMeta = next.meta,
      localReceipts = clone(next.operationReceipts),
      localView = clone(next.settings.find((r) => r.key === "listView"));
    for (const name of STORE_NAMES) next[name] = clone(data.master[name]);
    next.meta = localMeta;
    const receipts = new Map(next.operationReceipts.map((r) => [r.id, r]));
    for (const r of localReceipts) {
      if (receipts.has(r.id))
        assert(
          canonical(receipts.get(r.id)) === canonical(r),
          "操作履歴の同じIDが競合しています",
        );
      else next.operationReceipts.push(r);
    }
    stateOf(next).ledgerSequence = stateOf(data.master).ledgerSequence;
    if (localView) {
      next.settings = next.settings.filter((r) => r.key !== "listView");
      next.settings.push(localView);
    }
    nq.master = clone(data.master);
    nq.masterVersion = data.masterVersion;
    nq.members = clone(data.members);
  } else if (isChild(current) && data.masterVersion === q.masterVersion)
    assert(
      canonical(q.master) === canonical(data.master),
      "同じ親版の内容が一致しません",
    );
  nq.events = unionEvents(q.events, data.events);
  if (isChild(current) && data.masterVersion >= q.masterVersion) {
    const confirmed =
      data.parentEventIds ??
      (data.senderId === data.parentId
        ? data.events.map((e) => e.id)
        : undefined);
    if (confirmed !== undefined)
      nq.confirmedEventIds =
        data.masterVersion === q.masterVersion
          ? [...new Set([...(q.confirmedEventIds || []), ...confirmed])]
          : clone(confirmed);
    else if (data.masterVersion > q.masterVersion) delete nq.confirmedEventIds;
  }

  validateSharing(nq);
  const results = materialize(next, nq);
  if (!isChild(next)) recalculateClosed(next, operationId, "family-import");
  const after = new Map(next.transactions.map((t) => [t.id, canonical(t)]));
  const counts = { added: 0, changed: 0, deleted: 0 };
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (!before.has(id)) counts.added++;
    else if (!after.has(id)) counts.deleted++;
    else if (before.get(id) !== after.get(id)) counts.changed++;
  }
  const conflicts = results
    .filter((r) => r.losers.length)
    .map((r) => ({
      recordId: r.id,
      winner: clone(r.winner),
      losers: clone(r.losers),
      reason:
        r.winner.deviceId === q.parentId
          ? "親の変更を優先"
          : "子の登録順を優先",
    }));
  // The caller appends its receipt before validating the resulting store graph.
  return {
    stores: next,
    report: {
      ...counts,
      conflicts,
      balanceBefore: poolBalance(current),
      balanceAfter: poolBalance(next),
      child: isChild(next),
    },
  };
}
export class FamilySharing {
  constructor(db) {
    this.db = db;
  }
  setup(name, revision) {
    return this.db.command(
      "family-setup",
      { name },
      (s) => {
        assert(!sharing(s), "共有設定は既にあります");
        const parent = uuid(),
          q = {
            version: 1,
            bookId: uuid(),
            parentId: parent,
            deviceId: parent,
            members: [{ id: parent, name: cleanName(name), order: 0 }],
            masterVersion: 0,
            events: [],
            master: null,
          };
        stateOf(s).sharing = q;
        for (const t of s.transactions)
          q.events.push({
            id: uuid(),
            recordId: t.id,
            deviceId: parent,
            parents: [],
            value: clone(t),
          });
        return [parent];
      },
      { expectedRevision: revision },
    );
  }
  register(name, revision) {
    return this.db.command(
      "family-register",
      { name },
      (s) => {
        const q = sharing(s);
        assert(q && !isChild(s), "子登録は親端末専用です");
        const member = {
          id: uuid(),
          name: cleanName(name),
          order: q.members.length,
        };
        q.members.push(member);
        return [member.id];
      },
      { expectedRevision: revision },
    );
  }
  join(data, revision) {
    validateExchange(data);
    assert(data.joinDeviceId, "親が作成した子参加ファイルを選んでください");
    return this.db.command(
      "family-join",
      { bookId: data.bookId, target: data.joinDeviceId },
      (s) => {
        assert(!sharing(s), "共有設定済み端末は参加し直せません");
        for (const name of STORE_NAMES) s[name] = clone(data.master[name]);
        const st = stateOf(s);
        st.datasetId = this.db.generation;
        st.datasetRevision = revision;
        st.sharing = {
          version: 1,
          bookId: data.bookId,
          parentId: data.parentId,
          deviceId: data.joinDeviceId,
          members: clone(data.members),
          masterVersion: data.masterVersion,
          master: clone(data.master),
          events: clone(data.events),
          confirmedEventIds: clone(
            data.parentEventIds ?? data.events.map((e) => e.id),
          ),
        };
        materialize(s, st.sharing);
        return [data.joinDeviceId];
      },
      { expectedRevision: revision },
    );
  }
  async preview(data) {
    data = validateExchange(data);
    const s = await this.db.snapshot(),
      op = uuid(),
      r = mergeState(s, data, op);
    r.stores.operationReceipts.push({
      id: op,
      command: "family-import",
      payloadFingerprint: "preview",
      resultIds: [],
      committedAt: now(),
    });
    validateStores(r.stores);
    return {
      data: clone(data),
      revision: stateOf(s).datasetRevision,
      generation: stateOf(s).datasetId,
      report: r.report,
    };
  }
  import(preview) {
    return this.db.command(
      "family-import",
      {
        source: preview.data.senderId,
        version: preview.data.masterVersion,
        events: preview.data.events.map((e) => e.id),
      },
      (s) => {
        assert(
          stateOf(s).datasetId === preview.generation,
          "確認後に復元されています。再確認してください",
        );
        const op = uuid(),
          result = mergeState(s, preview.data, op);
        result.stores.operationReceipts.push({
          id: op,
          command: "family-settlement",
          payloadFingerprint: "{}",
          resultIds: [],
          committedAt: now(),
        });
        for (const name of STORE_NAMES) s[name] = result.stores[name];
        return [];
      },
      { expectedRevision: preview.revision },
    );
  }
  export(target) {
    return this.db.snapshot().then((s) => exchange(s, target));
  }
}
export function pendingSettlements(s) {
  return isChild(s)
    ? s.periods.filter(
        (p) =>
          p.state === "closed" &&
          periodFigures(s, p.id).settlementDifference !== 0,
      ).length
    : 0;
}
