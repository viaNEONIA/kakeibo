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
- プール月末残高 = 前月末残高 + 当月追加 − 当月配分 + 調整
- 目標達成率 = プール残高 / 目標額 × 100（目標未設定・0円は非表示）

## 要整合性確認
1. 月末未使用予算をいつ・どの月にプールへ計上するか。締め後の過去月編集と二重計上防止。
2. 当月予算へプールから配分した金額のうち未使用分を月末に再びプールへ戻す場合、資金の循環が二重計上にならないか。原資追跡・計算例で検証。
3. 繰越額が不足する過去月修正時の表示と修復手順。負残高を許すか未確定。
4. 月別目標変更履歴の有効日（年月単位か日時単位か）。
5. 締め済み月と未締め月の扱い、月末31日指定の処理。
6. 収入と予算の連動可否、プラス残額のみの繰越か、項目別繰越の有無。

## データ整合性原則
残高の唯一の正本を画面用キャッシュにしない。履歴から再計算可能とする。取引削除・編集時は影響する月以降を再計算。配分や調整の履歴を勝手に消さない。IndexedDBスキーマとアプリ版は別管理。
