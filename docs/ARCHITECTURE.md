# 技術構成 — 0.6.0-dev

静的HTML/CSS/JavaScriptのPWA。GitHub Pagesの `/kakeibo/` 配下で公開し、ブラウザー内のIndexedDBに保存します。ビルド、本番パッケージ、外部CDN、アプリサーバーは不要です。ソースと管理文書の正本はGitHubです。

## 構成と責務

| ファイル/モジュール | 責務 |
| --- | --- |
| `index.html` / `css/style.css` | 5画面・入力/編集/確認・保存パネル、レスポンシブ表示 |
| `manifest.webmanifest` / `icons/` | PWA名/アイコン、id `/kakeibo/`、scope/start_url `./` |
| `sw.js` | 範囲別の版キャッシュ、オフライン、明示更新、manifest取得 |
| `js/app.js` | 起動・画面・入力/一覧・状態/下書き・機能UIの接続 |
| `js/schema.js` / `js/validation.js` | DB版/17ストア/初期値、型・参照・計算・共有状態の検証 |
| `js/db.js` | 一貫したスナップショット、原子的コマンド、競合/世代制御、移行、JSON復元 |
| `js/domain.js` | 収支・項目・日付所属、期間生成、締め済み期間の差額再精算 |
| `js/budget.js` / `js/budget-ui.js` | 予算/配分/調整/締め/期間変更、プール計算と画面 |
| `js/share-state.js` / `js/share.js` / `js/share-ui.js` | 家計簿/端末ID、変更DAG・競合採否、親子参加/統合/管理値配布 |
| `js/child-preview.js` | 子の未確認取引を含む仮集計。確定台帳を変更しない |
| `js/restore-policy.js` | 初期状態への親バックアップ復旧の条件 |
| `js/goals.js` / `js/goal-ui.js` | 期間別目標、率/不足額、初回達成と画面 |
| `js/recurring.js` / `js/recurring-ui.js` | 毎月のルール・予定候補・単回手動確定、設定/ホーム表示 |
| `js/csv.js` | 収支/確定プールの別CSV、引用/改行/BOM/数式対策 |
| `js/file-save.js` / `js/file-identity.js` | JSON/CSV保存リンク・共有案内、JSON用途/作成元の識別 |
| `tests/` / `docs/` | 自動試験、仕様・実装・受入・履歴資料 |

## 保存・計算

DB名 `kakeibo-pwa`、版2、17ストア。旧DB版1から非破壊変換します。JSONは未共有形式1/共有形式2、現行dbSchemaVersionは2。交換用JSONは別形式です。

業務変更は保存時点のrevision・復元世代を照合し、必要な取引/予算/予定/台帳/履歴/共有イベント/初回達成/操作記録を一つのトランザクションで保存します。外部読込・ユーザー確認・ネットワーク待ちはその外で行います。失敗時は全体を戻し、無言初期化を行いません。

収支・予算・プールを別概念にし、表示は保存済み原本から導出します。子の仮表示・定期の未確定予定・未締め見込みを確定プールへ混ぜません。[データ構造](DATA_MODEL.md)・[計算](CALCULATION_SPEC.md)・[保存契約](STORAGE_PROTOCOL.md)を参照。

## PWA更新

アプリシェルは `kakeibo-shell-v13` の範囲別キャッシュを優先し、利用者の明示更新で切り替えます。入力中の強制再読込はしません。manifestのみネットワーク優先（no-store・3秒上限）で、成功したJSONを保存し、失敗時は既存キャッシュを使います。他アプリのキャッシュ/Service Workerを削除しません。

インストール登録はブラウザー/OS側の状態も関わります。現在は成功確認あり・再発監視中で、アプリの設定修正だけで恒久解決したとは断定しません。[識別ID](PWA_IDENTITY.md)・[manifest取得](MANIFEST_REFRESH.md)を参照。

## ファイル交換と制限

家族共有は同一家計簿のJSON手動交換で、サーバー同期ではありません。復元用JSONの全量置換と変更の統合を別操作にします。親子権限はアプリ内の操作制御であり、JSONの署名・暗号化・相手の所有者認証を提供しません。

CSVは集計用。JSON/CSVとも保存要求と保存完了を区別し、画面に保存リンクを維持します。アプリ内共有の可否は環境依存で、保存先から共有する手順を表示します。終了中のプッシュ通知はなく、目標通知は画面内の初回達成記録です。
