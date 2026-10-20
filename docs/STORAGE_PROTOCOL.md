# STORAGE_PROTOCOL — 保存・重複防止・移行 v1

Issue #3の技術設計。I04で初期化・原子的な保存基盤・設定保存・JSONバックアップ/復元を実装。業務コマンドは後続工程。

## コマンド保存契約

各登録・編集・削除・確定・取消・設定変更・復元にoperationIdを発行。意図した別の連続登録には別ID、同じ保存の再試行には同じIDを使う。IDとpayloadFingerprintを照合し、同じID/同じ入力は成功済み結果を返し、同じID/別入力は拒否する。
保存層はoperationReceiptsを読んでから、対象とrevisionを再読込、検証、更新、関連計算、履歴、receipt、datasetRevision増加までを一つのreadwriteトランザクションで扱う。成功表示は保存完了後のみ。エラー/容量不足/中断時は全体をロールバックし入力を保持する。

## 操作ごとの更新対象

| 操作 | 同じ保存境界へ含めるストア |
| --- | --- |
| 収支登録/編集/削除 | transactions、必要なperiods、recurringOccurrences、影響する精算/台帳/履歴、meta、operationReceipts |
| 定期手動確定 | recurringRules読込、recurringOccurrences、transactions、必要なperiods、精算/台帳/履歴、meta、receipt |
| 予算/振分編集・コピー | periodBudgets、categoryBudgets、budgetRevisions、必要な精算/台帳/履歴、meta、receipt |
| 配分/取消/調整 | carryoverEntries、periodClosings、closingRevisions、meta、receipt。予算振分も同境界で読込検証 |
| 初回締め/再確定/過去再評価 | periods、periodClosings、closingRevisions、carryoverEntries、必要な元データ読込、meta、receipt |
| 期間設定変更 | periodPolicies、periods、settings、必要な予算データ、meta、receipt |
| 目標変更/解除 | goalHistory、meta、receipt |
| 達成通知 | goalHistory/台帳読込、goalNotifications、meta |

表内のreceiptはoperationReceipts。初期版では関連ストア全体を同一のreadwriteスコープへ含めて競合を直列化してよい。実装時にスコープを狭めても、検証に使った値の競合保護を外さない。
外部ネットワーク・ユーザーの確認待ち・ファイル読込等は保存開始前に完了させる。トランザクション内でDBと無関係な非同期処理を待たない。アプリ表示用キャッシュを整合性判定の根拠にしない。

## 二重操作と複数タブ

- 定期確定: ruleId/scheduleMonthの一意キーとoccurrenceIDの一意索引、同一保存境界で実績生成。2タブの同時確定でも実績1件。
- 同じ金額の連続入力を内容一致だけで重複判定しない。別operationIdなら正当な別取引。
- 編集はexpectedRevisionを照合。不一致は自動上書きせず再読込して競合を示す。
- 配分は保存時点の台帳残高と現在入力を再読込。表示時に残高があっても、同時保存で不足するなら拒否する。
- 閉じた期間の再精算はinputRevisionと反映済settlementTotalを読んでDを決定し、履歴と同時更新。古いタブの古い精算額で上書きしない。
- 他タブへの更新通知は表示更新の補助。永続化と競合防止の正本はDBトランザクションとrevision。
- JSON復元でdatasetIdを新しい世代として記録し、他タブが旧世代を基に書込むことを拒否する。バックアップ中の元datasetIdは復元監査情報に保持。

## バックアップ形式v1

JSONの外側: format=kakeibo-pwa、backupFormatVersion=1、dbSchemaVersion=1、createdAt、sourceDatasetId、stores（17ストアの配列）、recordCounts。業務データ・設定・履歴・通知/操作記録を全量含める。metadataは件数・形式の検証用であり改ざん検知の保証とはしない。
全ストアを同じ読取トランザクションから取得して一貫したスナップショットを作成し、その後JSON化。精算や期間変更の途中状態を混ぜない。

復元手順:

1. 上書き説明と現状バックアップ案内を行い、ユーザーの復元操作を受ける。
2. DB書込前にファイル全体を解析し、形式/対応版/全ストア/件数/型/日付/金額/参照/一意制約/期間連続性/台帳精算一致を検証する。
3. 未知の新しい形式版・DB版は拒否。旧版は明示的な移行経路がある場合だけ変換し再検証する。初版に架空の旧形式対応を作らない。
4. 全ストアのclearと投入、復元世代記録を一つのreadwriteトランザクションで行う。途中失敗は既存データへ戻り、部分復元しない。
5. 保存完了後にメモリのDB状態を再読込し成功表示。他タブは世代確認で再読込を要求する。

同じIDが別ストアにあること自体は禁止しない。ID/複合キー重複は各ストアのキー領域と一意索引ごとに検出し、参照先もストアを区別して検証する。全量復元自体は統合しない。追加の家族共有統合はFAMILY_SHARINGで別操作として定義する。

## IndexedDB版の移行

初期版1を作成。以後の変更は旧版→新版の移行を明示し、追加/変換と索引作成を版更新内で扱う。レコードの無言削除・DB全削除による初期化を禁止。失敗時は旧状態を維持しエラー表示。
別タブが更新を妨げる場合は閉じる/再読込を案内し、強制初期化しない。アプリ資産更新とDB移行を区別し、入力中の強制リロードは禁止。具体コードとブラウザ別検証はI04で実施。

## 将来実装で必要な検証

全更新箇所への途中失敗、容量不足、二重タップ、2タブ同時操作、古いrevision、復元と他タブ保存の競合、未知形式拒否、一括復元失敗、版更新ブロック、再締め/過去修正の台帳一致を確認する。ここに動作試験結果は含まない。

## 家族共有の保存プロトコル追補

DB版2へ明示移行。通常収支変更と因果履歴を同じトランザクションで記録し、削除も履歴に残す。共有統合はプレビュー後のdatasetId/datasetRevisionを再検証し、管理データ・取引解決・差額精算・監査・操作履歴を原子的に保存する。子では精算しない。旧バックアップは入力ファイルを変えず版2へ変換。共有状態の通常復元は同一家計簿・元の端末IDを維持。詳細はFAMILY_SHARING参照。
