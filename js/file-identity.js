import { stateOf } from "./schema.js";

// Display metadata only; validation and import permissions remain with the callers.
export function fileIdentity(data) {
  const backup = data.format === "kakeibo-pwa";
  const q = backup ? stateOf(data.stores).sharing : data;
  const senderId = backup ? q?.deviceId : q?.senderId;
  const member = q?.members?.find((m) => m.id === senderId);
  const purpose = backup
    ? "復元用バックアップ"
    : data.joinDeviceId
      ? "子参加用"
      : "家族統合用";
  const role = q ? (senderId === q.parentId ? "親" : "子") : "単独";
  return {
    purpose,
    role,
    source: member
      ? `${role}・${member.name}（${senderId}）`
      : "単独利用（作成元端末の記録なし）",
    book: q?.bookId || "共有未設定",
    senderId,
    memberName: member?.name,
    created:
      new Date(data.createdAt).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      }) + "（日本時間）",
  };
}
const safe = (s) =>
  String(s)
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}<>:"/\\|?*]/gu, "_")
    .replace(/\s+/g, "_")
    .slice(0, 40) || "端末";
export function jsonFilename(data) {
  const i = fileIdentity(data);
  const stamp = new Date(data.createdAt).toISOString().replace(/[:.]/g, "-");
  return `kakeibo-${i.purpose}-${i.role}${i.memberName ? "_" + safe(i.memberName) : ""}${i.senderId ? "_" + safe(i.senderId).slice(0, 8) : ""}-${stamp}.json`;
}
export function fileSummary(data, filename) {
  const i = fileIdentity(data);
  return `選択ファイル：${filename} ／ 用途：${i.purpose} ／ 作成元：${i.source} ／ 作成日時：${i.created} ／ 家計簿：${i.book}`;
}
