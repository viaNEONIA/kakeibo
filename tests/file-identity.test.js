import test from "node:test";
import assert from "node:assert/strict";
import { initialStores } from "../js/schema.js";
import {
  fileIdentity,
  jsonFilename,
  fileSummary,
} from "../js/file-identity.js";
const at = "2026-10-20T07:53:45.305Z";
const family = () => ({
  format: "kakeibo-family",
  createdAt: at,
  senderId: "parent-123",
  parentId: "parent-123",
  bookId: "book-123",
  members: [
    { id: "parent-123", name: "家族/親:端末\u202e.json" },
    { id: "child-456", name: "子端末" },
  ],
});
test("three purposes have distinct filenames, source role and safe terminal name", () => {
  const f = family(),
    join = { ...f, joinDeviceId: "child-456" };
  const stores = initialStores();
  const backup = { format: "kakeibo-pwa", createdAt: at, stores };
  assert.match(jsonFilename(f), /家族統合用-親/);
  assert.match(jsonFilename(join), /子参加用-親/);
  assert.match(jsonFilename(backup), /復元用バックアップ-単独/);
  assert(!/[\/:\u202e]/u.test(jsonFilename(f)));
  assert.match(
    fileSummary(f, "renamed.json"),
    /renamed.json.*家族統合用.*家族\/親:端末.*16:53:45.*book-123/,
  );
  assert.equal(fileIdentity({ ...f, senderId: "child-456" }).role, "子");
});
test("legacy backup has explicit unknown source and file inspection does not mutate content", () => {
  const d = { format: "kakeibo-pwa", createdAt: at, stores: initialStores() };
  const before = structuredClone(d);
  assert.match(fileSummary(d, "legacy.json"), /作成元端末の記録なし/);
  jsonFilename(d);
  assert.deepEqual(d, before);
});
