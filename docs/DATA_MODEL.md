# DATA_MODEL — IndexedDB物理設計 v1

対象: 正式仕様v1.3と承認済み追補。Issue #3の設計成果物。I04でDB版1の生成とバックアップ/復元基盤を実装済み。業務コマンドは後続。プロダクト仕様はSPEC、OPERATIONS_DECISION、CARRYOVER_DECISIONを優先し、本書は保存方式を定義する。

## 型と共通制約

- DB名: kakeibo-pwa、初期DB版1。アプリ版・仕様版・バックアップ形式版とは別管理。
- IDは不変のUUID文字列。複合キーは配列。年月ラベルを主キーに使わない。
- CivilDate=実在するYYYY-MM-DD、Month=YYYY-MM、業務日付の解釈はAsia/Tokyo。監査時刻はUTCのISO文字列、日付所属を監査時刻から推測しない。
- moneyは整数円。通常取引amountは1〜999,999,999。予算/振分/配分は非負の安全整数、目標は正の安全整数。台帳増減は符号付き安全整数。計算の各加減算・総和で安全整数範囲を検証し、桁あふれは保存前に拒否する。
- 可変レコードはrevision（1から増加）、createdAt、updatedAtを持つ。参照整合性・列挙値・金額・日付は保存層で検証。索引の一意性だけに依存しない。
- 初期プール額はopeningエントリ1件で表現。初期値0円。未精算額・配分可能額は導出し独立した残高として保存しない。

## ストア・主キー・索引

索引欄のuはunique、その他は非unique。索引なしは—。

| store | keyPath | 主なデータ | 索引 |
| --- | --- | --- | --- |
| meta | key | schemaInfo、datasetId、datasetRevision、ledgerSequence | — |
| categories | id | type(income/expense)、name、sortOrder、active、revision | typeOrder=[type,sortOrder] |
| transactions | id | type(income/expense/refund)、date、periodId、categoryId、amount、name、memo、occurrenceId?、revision | date、periodDate=[periodId,date]、categoryDate=[categoryId,date]、occurrenceId(u・任意時のみ) |
| periodPolicies | id | startDay(1..28)、effectiveFrom、revision | effectiveFrom(u) |
| periods | id | startDate、endDate、labelMonth、kind(normal/transition)、policyId、state(open/closed)、sequence、revision | startDate(u)、sequence(u)、labelMonth |
| periodBudgets | periodId | baseBudget、revision | — |
| categoryBudgets | [periodId,categoryId] | amount、revision | periodId |
| budgetRevisions | id | periodId、before、after、reason、operationId | periodId、operationId |
| recurringRules | id | type(income/expense)、name、amount、categoryId、dayOfMonth(1..31)、activeFrom/Until、enabled、revision | — |
| recurringOccurrences | [ruleId,scheduleMonth] | id、scheduledDate、ruleRevision、snapshot、status(pending/confirmed/voided)、transactionId? | id(u)、scheduledDate、transactionId(u・任意時のみ) |
| carryoverEntries | id | periodId、kind(opening/allocate/adjust/settle/reverse)、delta、operationId、sequence、reversalOf? | periodSequence=[periodId,sequence]、sequence(u)、operationId、reversalOf(u・任意時のみ) |
| periodClosings | periodId | inputRevision、settlementTotal、closeRevision、lastOperationId | — |
| closingRevisions | id | periodId、previousTotal、newTotal、delta、reason、operationId | periodId、operationId |
| goalHistory | id | effectivePeriodId、targetAmount|null、sequence、createdAt | effectivePeriodSequence=[effectivePeriodId,sequence]、sequence(u) |
| goalNotifications | goalRevisionId | firstReachedAt、periodId | — |
| operationReceipts | id | command、payloadFingerprint、resultIds、committedAt | — |
| settings | key | value、revision | — |

各ストアのレコード共通情報は上記の型ルールに従う。合計17ストア。metaは単一の初期化記録と更新カウンタを含む。バックアップには全17ストアを含める。

## 参照と識別

- periodIdは実期間の固定ID。endDateまで含む。期間列はstartDate<=endDate、重複なし・隣接期間は前終了日の翌日開始を検証。変更時は現期間の締め後に移行期間/新方針を追加し、過去期間の境界は更新しない。
- labelMonthはendDateの年月で表示専用。移行期間と通常期間が同じlabelMonthでも衝突しない。CSVには開始/終了日を出す。
- transactions.periodIdは日付から解決して保存する。日付編集では旧/新期間を再評価、より早い期間以降を再計算する。未作成の対象期間は同一保存処理で生成・検証し、期間欠落を放置しない。
- categoriesは履歴から参照されている限り物理削除しない。無効化して新規候補から外す。incomeはincome項目、expense/refundはexpense項目を参照する。
- refundは正のamountとexpense項目を持ち、返金日の純支出を減らす。元取引への必須リンクや返金総額制限は新たに導入しない。
- recurringOccurrencesは暦月ごとにruleIdとscheduleMonthで一意。移行期間を追加しても予定を増殖させない。予定日・金額・名称・項目をsnapshotとして確定取引へコピーし、後のルール変更で確定実績を書き換えない。
- 定期取引の削除時はoccurrenceをvoidedにし参照を外す。自動で実績を復活させない。再登録の操作詳細に新たな仕様判断が必要なら実装時にIssue化する。
- goalHistoryは表示月に対応する期間IDと順序で有効化。同じ月名の期間があっても具体期間を明示。同一適用期間内の変更はsequenceで保持、最後の設定が有効。解除もtargetAmount=nullの履歴。過去境界は固定し、期間設定変更で履歴を書き換えない。
- goalNotificationsは目標設定レコードIDで一意。同額への再設定も新しい設定履歴となる。同じ設定で減少/再達成しても二重通知しない。

## 原本と導出値

収支・予算・台帳・精算版・目標履歴が原本。月別表示、純支出、使用率、実残高、未精算額、配分可能額は導出値。[CALCULATION_SPEC](CALCULATION_SPEC.md)参照。
periodClosings.settlementTotalはその期間ですでに反映した精算額。台帳settleの合計と必ず一致させる。過去修正に伴う再評価は差額台帳とclosingRevisionsを追加し、古い台帳を削除しない。

## 保存と復元

一意操作ID、原子的な更新、複数タブの競合、スキーマ移行とJSON全量復元は[STORAGE_PROTOCOL](STORAGE_PROTOCOL.md)を参照。自動採番のローカル順序はmetaで確保し、トランザクション内で一意性を検証する。

## I04で固定したバックアップ履歴の形

budgetRevisionsのbefore/afterは{baseBudget,categoryBudgets:[{categoryId,amount}]}。closingRevisionsはcloseRevisionを1から連番で持ち、期間内のpreviousTotal→newTotalの連鎖と最終反映額を復元時に検証する。settings.preferences.valueはstartDayとwarningPercentを含む（初期1と80、注意閾値の入力範囲1〜99%）。optional一意参照はnullでなく未設定フィールドとして扱う。meta.stateにdatasetId/datasetRevision/ledgerSequence、meta.schemaInfo.valueにdbSchemaVersionを保持。復元時はmeta.stateへrestoredFromDatasetId/restoredAtを追加し新世代へ切替。

## I05業務保存の追補

js/domain.jsで項目・並び替え・一覧表示設定と収支の登録/編集/削除を実装。settings.listView.valueは{sort:date-desc|date-asc|amount-desc|amount-asc,showDate:boolean,showCategory:boolean}。旧バックアップでlistViewがない場合は日付新順・日付/項目表示を初期表示として使用する。DB版とバックアップ版は1を維持。
取引の日付所属は固定periodId、期間生成は欠落なしに接続、前方向追加時の内部sequenceは日付順へ再設定するが既存ID/境界は不変。締め済み期間の修正はclosingRevisionsとsettle差額を原子的に追加し、未精算額を別途保存しない。項目は無効化して参照を残す。

## 家族共有保存追補 — 2026-10-20

DB版2。既存17ストア/キー/索引を維持し、meta.state.sharingへ共有ID・端末登録・因果的変更イベント・親確定版を追加。子は親管理データのスナップショットを保持。通常取引の実体と変更ログの解決結果を検証し、子の締め済み期間は親再精算待ちを許容する。詳細はFAMILY_SHARING参照。
