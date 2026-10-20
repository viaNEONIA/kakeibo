import { FamilySharing, pendingSettlements } from "./share.js";
import { sharing, isChild } from "./share-state.js";
import { stateOf } from "./schema.js";
import { yen } from "./domain.js";
const $ = (id) => document.getElementById(id);
const text = (tag, value) => {
  const e = document.createElement(tag);
  e.textContent = value;
  return e;
};
export function createShareUI({ getState, run, refresh, notify, hasDraft }) {
  let pending = null,
    lastReport = null;
  const service = () => new FamilySharing(getState().db),
    revision = () => stateOf(getState().current).datasetRevision;
  function save(data) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(data)], { type: "application/json" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download =
      "kakeibo-family-" +
      (data.joinDeviceId ? "join-" : "") +
      data.createdAt.replace(/[:.]/g, "-") +
      ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("family-setup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (
      !confirm(
        "この家計簿の親をこの端末に設定します。共有後のバックアップは形式v2となり、旧版アプリでは読めません。続けますか？",
      )
    )
      return;
    run(async () => {
      await service().setup($("family-parent-name").value, revision());
      await refresh();
      notify("親端末を設定しました。");
    });
  });
  $("family-register-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      const r = await service().register(
        $("family-child-name").value,
        revision(),
      );
      await refresh();
      save(await service().export(r.resultIds[0]));
      $("family-child-name").value = "";
      notify(
        "子参加ファイルを保存しました。割り当てた1台だけに渡してください。",
      );
    });
  });
  $("family-export").addEventListener("click", () =>
    run(async () => {
      save(await service().export());
      notify("統合用ファイルを保存しました。");
    }),
  );
  function report(container, r, q) {
    const name = (id) => q.members.find((m) => m.id === id)?.name || id;
    container.replaceChildren(
      text(
        "p",
        "追加 " +
          r.added +
          "件 ／ 変更 " +
          r.changed +
          "件 ／ 削除 " +
          r.deleted +
          "件",
      ),
      text(
        "p",
        "確定プール " +
          yen(r.balanceBefore) +
          " → " +
          yen(r.balanceAfter) +
          (r.child ? "（子では精算せず、親の確定結果を表示）" : ""),
      ),
    );
    container.append(
      text(
        "p",
        "競合 " +
          r.conflicts.length +
          "件。優先順位は並行変更にだけ適用します。",
      ),
    );
    for (const c of r.conflicts) {
      const d = document.createElement("details");
      d.append(text("summary", c.reason + "：" + c.recordId));
      for (const [label, events] of [
        ["採用", [c.winner]],
        ["不採用", c.losers],
      ])
        for (const e of events) {
          const v = e.value;
          d.append(
            text(
              "p",
              label +
                "：" +
                name(e.deviceId) +
                " ／ " +
                (v
                  ? v.date +
                    " " +
                    v.type +
                    " " +
                    yen(v.amount) +
                    " " +
                    v.name +
                    " " +
                    v.memo
                  : "削除"),
            ),
          );
        }
      container.append(d);
    }
  }
  for (const [id, mode] of [
    ["family-join-file", "join"],
    ["family-import-file", "merge"],
  ])
    $(id).addEventListener("change", () =>
      run(async () => {
        const file = $(id).files[0];
        $(id).value = "";
        if (!file) return;
        if (hasDraft())
          throw Error(
            "未保存の入力があります。保存または破棄してから取り込んでください",
          );
        if (file.size > 25 * 1024 * 1024)
          throw Error("共有ファイルは25MB以下にしてください");
        const data = JSON.parse(await file.text());
        if (mode === "join") {
          const { validateExchange } = await import("./share.js");
          validateExchange(data);
          if (!data.joinDeviceId)
            throw Error("親が作成した子参加ファイルを指定してください");
          if (sharing(getState().current))
            throw Error("既に共有設定されています");
          pending = { mode, data, revision: revision() };
          $("family-preview").replaceChildren(
            text(
              "p",
              "この端末の現在のデータ全体を、子参加ファイルの家計簿へ置き換えます。現在のJSONバックアップを保存してから実行してください。",
            ),
            text(
              "p",
              "参加する端末：" +
                data.members.find((m) => m.id === data.joinDeviceId).name,
            ),
          );
        } else {
          const preview = await service().preview(data);
          pending = { mode, preview };
          report($("family-preview"), preview.report, {
            members: preview.data.members,
          });
        }
        $("family-dialog").showModal();
      }),
    );
  $("family-cancel").addEventListener("click", () => {
    pending = null;
    $("family-dialog").close();
  });
  $("family-dialog").addEventListener("cancel", () => {
    pending = null;
  });
  $("family-confirm").addEventListener("click", () =>
    run(async () => {
      if (!pending) return;
      if (hasDraft()) throw Error("未保存の入力があります");
      if (pending.mode === "join") {
        await service().join(pending.data, pending.revision);
        lastReport = null;
      } else {
        await service().import(pending.preview);
        lastReport = pending.preview.report;
      }
      pending = null;
      $("family-dialog").close();
      await refresh();
      notify(
        "家族データを反映しました。親の確定結果は子端末へ配布してください。",
      );
    }),
  );
  function render(s, enabled) {
    const q = sharing(s),
      child = isChild(s);
    $("family-status").textContent = q
      ? "この端末：" +
        q.members.find((m) => m.id === q.deviceId).name +
        " ／ " +
        (child ? "子" : "親") +
        " ／ 家計簿 " +
        q.bookId +
        (pendingSettlements(s) ? " ／ 締め済み期間に親の再精算待ちあり" : "")
      : "共有未設定";
    $("family-setup-form").hidden = !!q;
    $("family-register-form").hidden = !q || child;
    $("family-export").hidden = !q;
    for (const id of [
      "family-setup",
      "family-register",
      "family-export",
      "family-join-file",
      "family-import-file",
      "family-confirm",
    ])
      $(id).disabled = !enabled;
    $("family-join-file").disabled = !enabled || !!q;
    $("family-import-file").disabled = !enabled || !q;
    $("family-members").replaceChildren(
      ...(q
        ? q.members.map((m) => {
            const row = document.createElement("p");
            row.append(
              text(
                "span",
                m.name +
                  "（" +
                  (m.order === 0 ? "親" : "子・優先順位" + m.order) +
                  "）",
              ),
            );
            if (!child && m.order > 0) {
              const b = text("button", "参加ファイルを再保存");
              b.type = "button";
              b.disabled = !enabled;
              b.addEventListener("click", () =>
                run(async () => save(await service().export(m.id))),
              );
              row.append(b);
            }
            return row;
          })
        : []),
    );
    if (lastReport && q) report($("family-result"), lastReport, q);
  }
  return {
    render,
    reset: () => {
      pending = null;
      lastReport = null;
      $("family-dialog").close();
    },
  };
}
