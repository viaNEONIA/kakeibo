import {
  sharing,
  isChild,
  guardCommand,
  recordChanges,
} from "./share-state.js";
import {
  DB_NAME,
  DB_VERSION,
  STORES,
  STORE_NAMES,
  initialStores,
  stateOf,
  uuid,
  now,
} from "./schema.js";
import {
  assert,
  safeAdd,
  validateStores,
  validateBackup,
} from "./validation.js";
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const completion = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("保存が中断されました"));
    tx.onerror = () => {};
  });
async function readAll(tx) {
  return Object.fromEntries(
    await Promise.all(
      STORE_NAMES.map(async (n) => [
        n,
        await request(tx.objectStore(n).getAll()),
      ]),
    ),
  );
}
function writeAll(tx, stores) {
  for (const n of STORE_NAMES) {
    const s = tx.objectStore(n);
    s.clear();
    for (const row of stores[n]) s.put(row);
  }
}
export class Database {
  constructor(db, onChange = () => {}) {
    this.db = db;
    this.generation = null;
    this.onChange = onChange;
    this.channel = globalThis.BroadcastChannel
      ? new BroadcastChannel(DB_NAME)
      : null;
    if (this.channel) this.channel.onmessage = () => onChange();
  }
  async snapshot() {
    const tx = this.db.transaction(STORE_NAMES, "readonly"),
      done = completion(tx);
    const data = await readAll(tx);
    await done;
    return data;
  }
  async initialize() {
    const tx = this.db.transaction(STORE_NAMES, "readwrite"),
      done = completion(tx);
    try {
      const current = await readAll(tx);
      if (!current.meta.length) {
        assert(
          STORE_NAMES.every((n) => current[n].length === 0),
          "初期化情報が不正です。既存データは変更していません",
        );
        const data = initialStores();
        validateStores(data);
        writeAll(tx, data);
      } else validateStores(current);
      await done;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
    this.generation = stateOf(await this.snapshot()).datasetId;
  }
  async refresh() {
    const s = await this.snapshot();
    validateStores(s);
    this.generation = stateOf(s).datasetId;
    return s;
  }
  async command(
    command,
    payload,
    mutate,
    { operationId = uuid(), expectedRevision } = {},
  ) {
    assert(typeof mutate === "function", "保存処理がありません");
    const fingerprint = JSON.stringify(payload),
      tx = this.db.transaction(STORE_NAMES, "readwrite"),
      done = completion(tx);
    try {
      const stores = await readAll(tx),
        state = stateOf(stores);
      assert(
        state.datasetId === this.generation,
        "別の画面でデータが復元されました。再読み込みしてください",
      );
      const previous = stores.operationReceipts.find(
        (r) => r.id === operationId,
      );
      if (previous) {
        assert(
          previous.command === command &&
            previous.payloadFingerprint === fingerprint,
          "同じ操作IDの入力が一致しません",
        );
        await done;
        return previous;
      }
      if (expectedRevision !== undefined)
        assert(
          state.datasetRevision === expectedRevision,
          "別の画面で変更されています。再読み込みしてください",
        );
      guardCommand(stores, command, payload);
      const before = structuredClone(stores);
      const result = mutate(stores);
      if (!command.startsWith("family-")) recordChanges(before, stores);
      if (sharing(stores) && !isChild(stores))
        sharing(stores).masterVersion = safeAdd(
          sharing(stores).masterVersion,
          1,
        );
      assert(
        !result || typeof result.then !== "function",
        "保存中に外部の非同期処理は実行できません",
      );
      stateOf(stores).datasetRevision = safeAdd(state.datasetRevision, 1);
      const receipt = {
        id: operationId,
        command,
        payloadFingerprint: fingerprint,
        resultIds: result || [],
        committedAt: now(),
      };
      stores.operationReceipts.push(receipt);
      validateStores(stores);
      writeAll(tx, stores);
      await done;
      this.channel?.postMessage({ changed: true });
      this.onChange();
      return receipt;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  async savePreferences(value, expectedRevision, operationId = uuid()) {
    return this.command(
      "save-preferences",
      value,
      (s) => {
        const row = s.settings.find((r) => r.key === "preferences");
        row.value = { ...row.value, ...value };
        row.revision = safeAdd(row.revision, 1);
        row.updatedAt = now();
        return [];
      },
      { operationId, expectedRevision },
    );
  }
  async backup() {
    const stores = await this.snapshot();
    validateStores(stores);
    return {
      format: "kakeibo-pwa",
      backupFormatVersion: sharing(stores) ? 2 : 1,
      dbSchemaVersion: DB_VERSION,
      createdAt: now(),
      sourceDatasetId: stateOf(stores).datasetId,
      stores,
      recordCounts: Object.fromEntries(
        STORE_NAMES.map((n) => [n, stores[n].length]),
      ),
    };
  }
  async restore(data, expectedRevision) {
    const incoming = structuredClone(validateBackup(data));
    const tx = this.db.transaction(STORE_NAMES, "readwrite"),
      done = completion(tx);
    try {
      const current = await readAll(tx),
        state = stateOf(current);
      assert(
        state.datasetId === this.generation,
        "別の画面で復元されています。再読み込みしてください",
      );
      assert(
        state.datasetRevision === expectedRevision,
        "確認後にデータが変わりました。復元内容を再確認してください",
      );
      if (sharing(current) || sharing(incoming.stores)) {
        assert(
          sharing(current) &&
            sharing(incoming.stores) &&
            sharing(current).bookId === sharing(incoming.stores).bookId,
          "共有中の復元は同じ家計簿に限定します。新しい端末は子参加ファイルを使用してください",
        );
        const own = sharing(current).deviceId;
        assert(
          sharing(incoming.stores).members.some((m) => m.id === own),
          "復元ファイルにこの端末の登録がありません",
        );
        const incomingShare = sharing(incoming.stores);
        if (own !== incomingShare.parentId && !incomingShare.master) {
          const master = structuredClone(incoming.stores);
          delete stateOf(master).sharing;
          incomingShare.master = master;
        }
        if (own === incomingShare.parentId) incomingShare.master = null;
        incomingShare.deviceId = own;
      }
      const newState = stateOf(incoming.stores);
      newState.restoredFromDatasetId = incoming.sourceDatasetId;
      newState.restoredAt = now();
      newState.datasetId = uuid();
      newState.datasetRevision = safeAdd(newState.datasetRevision, 1);
      validateStores(incoming.stores);
      writeAll(tx, incoming.stores);
      await done;
      this.generation = newState.datasetId;
      this.channel?.postMessage({ restored: true });
      this.onChange();
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  close() {
    this.db.close();
    this.channel?.close();
  }
}
export async function openDatabase({
  onBlocked = () => {},
  onVersionChange = () => {},
  onChange = () => {},
} = {}) {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onblocked = () => onBlocked();
  req.onupgradeneeded = (event) => {
    if (event.oldVersion === 1) {
      const store = req.transaction.objectStore("meta"),
        r = store.get("schemaInfo");
      r.onsuccess = () => {
        if (r.result?.value?.dbSchemaVersion !== 1) {
          req.transaction.abort();
          return;
        }
        store.put({
          key: "schemaInfo",
          value: { dbSchemaVersion: DB_VERSION },
        });
      };
      return;
    }
    if (event.oldVersion !== 0) {
      req.transaction.abort();
      return;
    }
    for (const [name, schema] of Object.entries(STORES)) {
      const store = req.result.createObjectStore(name, { keyPath: schema.key });
      for (const [indexName, raw] of Object.entries(schema.indexes || {}))
        store.createIndex(indexName, raw.key || raw, {
          unique: raw.unique === true,
        });
    }
  };
  const raw = await request(req);
  raw.onversionchange = () => {
    raw.close();
    onVersionChange();
  };
  assert(
    raw.objectStoreNames.length === STORE_NAMES.length &&
      STORE_NAMES.every((n) => raw.objectStoreNames.contains(n)),
    "DBストア構成が一致しません",
  );
  const db = new Database(raw, onChange);
  try {
    await db.initialize();
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
