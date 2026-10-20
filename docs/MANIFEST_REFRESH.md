# manifest更新取得 — 0.4.3-dev

## 確認したコード上の問題

main 36b35867fa32505a521a95e388edcd4aced1a413のService Workerはmanifestをアプリシェルと同じキャッシュ優先で返していた。保存済みのmanifestがあれば、新しいネットワーク応答を取得しない。PWA識別IDは既に /kakeibo/ であり、この変更ではIDを再変更しない。

manifestの新しさとアプリ本体の版の一貫性を分ける。ここで改善するのはService WorkerとブラウザーHTTPキャッシュ経由のmanifest取得であり、Chrome/WebAPK内部のインストール登録を修復する機能ではない。特定のインストール不可問題の原因・解消をこの変更だけで断定しない。

## 処理

1. 対象は同一オリジン・家計簿SW範囲の manifest.webmanifest のGETだけ。
2. fetchのcacheをno-storeにし、ブラウザーのHTTPキャッシュに依存せず取得する。
3. HTTP成功かつJSONオブジェクトの応答だけを、従来と同じCache APIキーへ保存する。キャッシュ書込に失敗しても、取得できた正常応答は返す。
4. 3秒で要求を中断。通信失敗・HTTPエラー・JSONパース失敗・配列など不正なJSONでは、最後に保存したmanifestを返す。
5. 保存済みmanifestもなければ要求を失敗させ、誤った応答を作って成功扱いしない。

既存のアプリシェルは版別のキャッシュ優先とし、入力中の自動再読込や自動の強制切替は追加しない。待機中Workerは利用者の明示更新で切替。v7へ更新するため、従来のWorkerがまだ制御している端末では最初にアプリの更新操作が必要。
識別ID /kakeibo/、manifest URL、start_url/scope、SW範囲、DB名/版/全データ、家族共有ID/端末ID、バックアップ形式は変更しない。別アプリのキャッシュ削除やSW解除は行わない。

no-storeはブラウザーのHTTPキャッシュ利用を避ける指定であり、GitHub Pages/CDN上の反映遅延やChrome内部のmanifest・インストール情報の更新を強制できるものではない。JSONとして正常でも、manifestの全フィールドがブラウザー要件を満たす保証をする検証ではない。

## 検証 — 2026-10-20

環境: Node24.19.0 / Playwright1.64.1 / Chromium153.0.8010.0。

| コマンド | 結果 |
| --- | --- |
| npm test | 55件合格 |
| npm run test:browser | 基盤13項目合格 |
| npm run test:browser:install | 識別ID/更新保持6項目合格 |
| npm run test:browser:manifest-refresh | 取得方式7項目合格 |

専用試験は同じWorkerのままHTTPキャッシュ有効期限内・Cache API保存済みの同一URLへ要求し、応答の識別用descriptionとHTTP要求回数で新規取得を確認する。アプリ本体の更新や別のmanifest URLへの切替に依存しない。
503・HTML応答・遅い応答では正常キャッシュを保持し、3秒の中断後に利用できることを確認。オフライン再起動、キャッシュ欠落時の失敗と通信復旧後の再保存、全IndexedDBレコード完全一致、別アプリ用試験キャッシュの保持も確認。
Android WebAPKのインストール成功・再発防止は未検証。デスクトップの通信試験をAndroid実機での再現試験と扱わない。

## 配信後の確認

1. アプリの明示更新を行い、設定の表示版が0.4.3-devとなったことを確認する。
2. Webページを再読み込みし、通常操作とインストール可否を確認する。
3. 改善しない場合はChromeの正確な版、再読込前後の実際のmanifest/Worker状態を確認して原因を切り分ける。

JSONの復元や再統合をインストール対策として要求しない。サイトデータ/Chromeストレージ消去や別アプリのアンインストールを手順に含めない。
