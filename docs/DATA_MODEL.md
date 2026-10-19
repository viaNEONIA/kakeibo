# データモデルと計算規則 v1.3

## IndexedDBストア（設計案）
- `transactions`: id(UUID), type(income|expense), date(YYYY-MM-DD), categoryId, name, amount(正整数円), memo, recurringRuleId?, createdAt, updatedAt。
- `categories`: id, type, name, sortOrder, active。
- `monthlyBudgets`: month(YYYY-MM), baseBudget, carryoverEnabled? 等。
- `categoryBudgets`: month, categoryId, amount。
- `recurringRules`: id, type, name, amount, dayOfMonth, categoryId, activeFrom, activeUntil, enabled。
- `recurringOccurrences`: ruleId, month, transactionId?, status。
- `carryoverTransfers`: id, effectiveMonth, sourceMonth?, kind(add|allocate|adjust|reverse), amount, createdAt。
- `carryoverGoalHistory`: id, targetAmount|null, effectiveMonth, createdAt。
- `budgetRevisions`: id, month, before, after, timestamp。
- `settings`: key, value。

上記ストアは実装設計案。最終のキー・インデックス・移行処理はWorkで整合性レビュー後に確定する。

## 基本式
- 月間収支 = 収入合計 − 支出合計
- 利用可能予算 = 基本予算 + 繰越プールから当月への配分
- 当月予算残額 = 利用可能予算 − 当月支出
- 月末精算額 = 基本予算 + 当月配分 − 当月支出（負数も精算）
- プール月末残高 = 前月末残高 + 月末精算額 − 当月配分 + 調整
- 目標達成率 = プール残高 / 目標額 × 100（目標未設定・0円は非表示）

## 決定と残課題

繰越原資・未使用配分戻し・超過精算・手動締め・差額再確定・過去修正の後続再計算・負残高警告・配分停止・初期残高0円は2026-10-19承認。物理ストアは引き続き設計案であり、正負精算と再確定の識別を表現できるようI03で再設計する。
[CARRYOVER_DECISION](CARRYOVER_DECISION.md)を計算と受入値の正本とする。保留額の導出表示と後月余剰による解消はQ-HOLDとして承認済み。配分可能額=max(実残高,0)、未精算額=max(-実残高,0)。未精算額を別の支出・控除として保存しない。目標の適用開始月・同月履歴保持、定期日の暦月末補正は承認済み。集計期間への月ラベル対応はP-Q01/P-Q02で未確定。

## データ整合性原則
残高の唯一の正本を画面用キャッシュにしない。履歴から再計算可能とする。取引削除・編集時は影響する月以降を再計算。配分や調整の履歴を勝手に消さない。IndexedDBスキーマとアプリ版は別管理。

## UI・運用決定のデータ設計への影響

[OPERATIONS_DECISION](OPERATIONS_DECISION.md)を参照。定期収入を含め、返金種別は元支出項目・返金日を保持し返金日の支出を減らす。通常取引金額は整数円1〜999,999,999、0円/小数を拒否。物理スキーマは設計案のまま、refund種別・通知履歴・期間定義・期間境界/識別子・スキーマ移行をI03で設計する。
JSON全ストアと設定・履歴を検証し一括置換、未知新版やID重複等は拒否。統合復元は初期対象外。期間が変わっても取引の元日付を保持する。monthキーだけで任意期間を表現できると仮定しない。
