import { stateOf, uuid } from "./schema.js";
export const sharing = (s) => stateOf(s)?.sharing;
export const isChild = (s) =>
  !!sharing(s) && sharing(s).deviceId !== sharing(s).parentId;
const check = (v, m) => {
  if (!v) throw Error(m);
};
const id = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
export function validateSharing(q) {
  if (!q) return;
  check(
    q.version === 1 && id(q.bookId) && id(q.parentId) && id(q.deviceId),
    "共有識別情報が不正です",
  );
  check(
    Array.isArray(q.members) && q.members.length > 0 && q.members.length <= 100,
    "登録端末が不正です",
  );
  const ids = new Set(),
    orders = new Set();
  for (const [index, m] of q.members.entries()) {
    check(
      m.order === index &&
        id(m.id) &&
        typeof m.name === "string" &&
        m.name.trim().length > 0 &&
        m.name.length <= 80 &&
        Number.isSafeInteger(m.order) &&
        m.order >= 0 &&
        !ids.has(m.id) &&
        !orders.has(m.order),
      "登録端末が重複または不正です",
    );
    ids.add(m.id);
    orders.add(m.order);
  }
  check(
    q.members[0].id === q.parentId &&
      q.members[0].order === 0 &&
      ids.has(q.deviceId),
    "親子登録が不正です",
  );
  check(
    Number.isSafeInteger(q.masterVersion) &&
      q.masterVersion >= 0 &&
      Array.isArray(q.events) &&
      q.events.length <= 100000,
    "共有履歴が不正です",
  );
  if (q.confirmedEventIds !== undefined) {
    const eventIds = new Set(q.events.map((e) => e.id));
    check(
      Array.isArray(q.confirmedEventIds) &&
        new Set(q.confirmedEventIds).size === q.confirmedEventIds.length &&
        q.confirmedEventIds.every((id) => eventIds.has(id)),
      "親の確認済み変更情報が不正です",
    );
  }
  const seen = new Map();
  // Events are stored in topological order. Parents must already exist and belong to the same record.
  for (const e of q.events) {
    check(
      id(e.id) &&
        id(e.recordId) &&
        ids.has(e.deviceId) &&
        Array.isArray(e.parents) &&
        new Set(e.parents).size === e.parents.length &&
        !seen.has(e.id),
      "変更履歴IDが不正です",
    );
    for (const p of e.parents)
      check(
        seen.has(p) && seen.get(p).recordId === e.recordId,
        "変更履歴の参照・順序が不正です",
      );
    check(
      e.value === null ||
        (e.value && e.value.id === e.recordId && typeof e.value === "object"),
      "変更内容が不正です",
    );
    if (e.value) {
      const t = e.value;
      check(
        ["income", "expense", "refund"].includes(t.type) &&
          typeof t.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
          id(t.categoryId) &&
          id(t.periodId) &&
          Number.isSafeInteger(t.amount) &&
          t.amount >= 1 &&
          t.amount <= 999999999 &&
          typeof t.name === "string" &&
          typeof t.memo === "string" &&
          Number.isSafeInteger(t.revision) &&
          t.revision >= 1,
        "変更履歴の収支が不正です",
      );
    }
    seen.set(e.id, e);
  }
}
export function heads(events, recordId) {
  const rows = events.filter((e) => e.recordId === recordId),
    parents = new Set(rows.flatMap((e) => e.parents));
  return rows.filter((e) => !parents.has(e.id));
}
export function resolved(q) {
  const order = new Map(q.members.map((m) => [m.id, m.order])),
    parents = new Set(q.events.flatMap((e) => e.parents)),
    groups = new Map();
  for (const e of q.events)
    if (!parents.has(e.id)) {
      if (!groups.has(e.recordId)) groups.set(e.recordId, []);
      groups.get(e.recordId).push(e);
    }
  return [...groups.keys()].sort().map((id) => {
    const candidates = groups
      .get(id)
      .sort(
        (a, b) =>
          order.get(a.deviceId) - order.get(b.deviceId) ||
          a.id.localeCompare(b.id),
      );
    check(
      new Set(candidates.map((e) => e.deviceId)).size === candidates.length,
      "同じ端末IDの並行変更があります。参加ファイルの複製や古い復元を確認してください",
    );
    return { id, winner: candidates[0], losers: candidates.slice(1) };
  });
}
export function recordChanges(before, s) {
  const q = sharing(s);
  if (!q) return;
  const old = new Map(before.transactions.map((t) => [t.id, t])),
    next = new Map(s.transactions.map((t) => [t.id, t]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id),
      b = next.get(id);
    if (canonical(a) !== canonical(b))
      q.events.push({
        id: uuid(),
        recordId: id,
        deviceId: q.deviceId,
        parents: heads(q.events, id).map((e) => e.id),
        value: b ? structuredClone(b) : null,
      });
  }
}
export function guardCommand(s, command, payload) {
  if (!isChild(s)) return;
  check(
    [
      "add-transaction",
      "edit-transaction",
      "delete-transaction",
      "ensure-budget-period",
      "save-list-view",
      "family-import",
    ].includes(command),
    "この操作は親端末専用です",
  );
  if (["edit-transaction", "delete-transaction"].includes(command)) {
    const t = s.transactions.find((t) => t.id === payload.id);
    check(!t?.occurrenceId, "定期リンク取引の変更は親端末で行ってください");
  }
}
export function unionEvents(a, b) {
  const map = new Map();
  for (const e of [...a, ...b]) {
    if (map.has(e.id))
      check(
        canonical(map.get(e.id)) === canonical(e),
        "同一変更IDの内容が一致しません",
      );
    else map.set(e.id, e);
  }
  const result = [],
    children = new Map(),
    counts = new Map();
  for (const e of map.values()) {
    counts.set(e.id, e.parents.length);
    for (const p of e.parents) {
      check(map.has(p), "変更履歴に欠落があります");
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(e.id);
    }
  }
  const queue = [...map.values()]
    .filter((e) => !e.parents.length)
    .map((e) => e.id)
    .sort();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    result.push(map.get(id));
    for (const child of (children.get(id) || []).sort()) {
      counts.set(child, counts.get(child) - 1);
      if (counts.get(child) === 0) queue.push(child);
    }
  }
  check(result.length === map.size, "変更履歴に循環があります");
  return result;
}

export function validateSharedTransactions(s) {
  const q = sharing(s);
  if (!q) return;
  const expected = resolved(q)
    .filter((r) => r.winner.value !== null)
    .map((r) => r.winner.value);
  check(
    expected.length === s.transactions.length,
    "収支と共有変更履歴の件数が一致しません",
  );
  const normalize = (t) => {
    const v = { ...t };
    delete v.periodId;
    return canonical(v);
  };
  const actual = new Map(s.transactions.map((t) => [t.id, normalize(t)]));
  for (const t of expected)
    check(
      actual.get(t.id) === normalize(t),
      "収支と共有変更履歴の内容が一致しません",
    );
}
