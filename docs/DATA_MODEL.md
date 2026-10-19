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
[CARRYOVER_DECISION](CARRYOVER_DECISION.md)を計算と受入値の正本とする。保留額の導出表示と後月余剰による解消はQ-HOLDとして承認済み。配分可能額=max(実残高,0)、未精算額=max(-実残高,0)。未精算額を別の支出・控除として保存しない。目標履歴有効日、短い月の定期処理等は未確定のまま。

## データ整合性原則
残高の唯一の正本を画面用キャッシュにしない。履歴から再計算可能とする。取引削除・編集時は影響する月以降を再計算。配分や調整の履歴を勝手に消さない。IndexedDBスキーマとアプリ版は別管理。
