import { jsonFilename } from "./file-identity.js";
const $ = (id) => document.getElementById(id);
export function createFileSaver() {
  let url = null,
    file = null,
    generation = 0;
  const status = (value, error = false) => {
    $("file-save-status").textContent = value;
    $("file-save-status").classList.toggle("error", error);
  };
  const canShare = () => {
    try {
      return (
        !!file &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      );
    } catch {
      return false;
    }
  };
  $("file-save-link").addEventListener("click", () => {
    if (file)
      status(
        "ブラウザーへ保存を要求しました。ダウンロード通知・保存先で確認してください。保存できない場合はファイル共有も利用できます。",
      );
  });
  $("file-save-close").addEventListener("click", () => {
    $("file-save-panel").hidden = true;
  });
  $("file-save-share").addEventListener("click", async () => {
    if (!canShare()) return;
    const token = generation,
      selected = file;
    $("file-save-share").disabled = true;
    try {
      // Called directly from this button's gesture, after the File is already prepared.
      await navigator.share({ files: [selected], title: selected.name });
      if (token === generation)
        status("ファイルを共有先へ渡しました。保存先で確認してください。");
    } catch (e) {
      if (token === generation)
        status(
          e.name === "AbortError"
            ? "共有をキャンセルしました。保存リンクから再保存できます。"
            : "共有できませんでした。「JSONを保存」から保存してください。",
          e.name !== "AbortError",
        );
    } finally {
      if (token === generation) $("file-save-share").disabled = false;
    }
  });
  return {
    async export(getData, { label, onPrepared } = {}) {
      const token = ++generation;
      file = null;
      $("file-save-panel").hidden = false;
      $("file-save-link").hidden = true;
      $("file-save-share").hidden = true;
      $("file-save-name").textContent = "";
      status(label + "を準備しています…");
      $("file-save-panel").scrollIntoView({ block: "center" });
      try {
        const data = await getData();
        const body = JSON.stringify(data, null, 2),
          name = jsonFilename(data);
        if (token !== generation) return;
        const blob = new Blob([body], { type: "application/json" }),
          previous = url;
        url = URL.createObjectURL(blob);
        file =
          typeof File === "function"
            ? new File([blob], name, { type: "application/json" })
            : blob;
        const link = $("file-save-link");
        link.href = url;
        link.download = name;
        link.hidden = false;
        $("file-save-name").textContent = name;
        $("file-save-share").hidden = !canShare();
        $("file-save-share").disabled = false;
        if (previous) setTimeout(() => URL.revokeObjectURL(previous), 60000);
        onPrepared?.(data);
        // Keep an attached, visible link and its URL alive even if this attempt is blocked.
        try {
          link.click();
        } catch {
          /* The visible link is the user-gesture fallback. */
        }
        status(
          label +
            "のJSONを準備しました。保存通知が出ない場合は「JSONを保存」を直接押してください。",
        );
      } catch (e) {
        if (token === generation)
          status(
            "ファイルを準備できませんでした：" + (e.message || "不明なエラー"),
            true,
          );
        throw e;
      }
    },
  };
}
