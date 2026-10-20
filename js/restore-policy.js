import { STORE_NAMES } from "./schema.js";
import { sharing } from "./share-state.js";
export const isParentBackup = (s) =>
  !!sharing(s) && sharing(s).deviceId === sharing(s).parentId;
// Empty period shells and display preferences are harmless; business records are not.
export function canRecoverParent(current, incoming) {
  if (!isParentBackup(incoming)) return false;
  const local = sharing(current);
  if (
    local &&
    !(
      local.deviceId === local.parentId &&
      local.members.length === 1 &&
      local.events.length === 0 &&
      local.bookId !== sharing(incoming).bookId
    )
  )
    return false;
  const structural = new Set([
    "meta",
    "settings",
    "operationReceipts",
    "carryoverEntries",
    "periods",
    "periodPolicies",
  ]);
  if (STORE_NAMES.some((n) => !structural.has(n) && current[n].length))
    return false;
  return (
    current.carryoverEntries.length === 1 &&
    current.carryoverEntries[0].kind === "opening" &&
    current.carryoverEntries[0].delta === 0
  );
}
