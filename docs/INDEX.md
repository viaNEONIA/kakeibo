# 文書一覧

現行アプリは0.6.1-dev。GitHubのmainが正本です。仕様・実装・試験結果・過去記録を区別して読めるよう分類します。

## 最初に読む

| 文書 | 用途 |
| --- | --- |
| [README](../README.md) | アプリの入口、現在版、基本操作、ファイル用途 |
| [TEST_CHECKLIST](TEST_CHECKLIST.md) | **54項目の実機試験リスト**。手順・期待値・環境/結果欄 |
| [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) | 実装済み、受入中、未実装/制限 |
| [TEST_RESULTS_CURRENT](TEST_RESULTS_CURRENT.md) | 現行実装時の自動試験根拠と実機の未確認範囲 |
| [OPEN_QUESTIONS](OPEN_QUESTIONS.md) | 未確定、今回の仕様実装差分、確認待ち |
| [WORK_HANDOVER](WORK_HANDOVER.md) | 継続開発/受入の引継ぎ |

## 現行の仕様・設計・管理

| 文書 | 用途 |
| --- | --- |
| [SPEC](SPEC.md) | 正式仕様v1.3＋承認済み追補 |
| [UI_SPEC](UI_SPEC.md) | 5画面の要件と現行UIの範囲 |
| [DATA_MODEL](DATA_MODEL.md) | 17ストア・DB版2・参照・保存値と導出値 |
| [CALCULATION_SPEC](CALCULATION_SPEC.md) | 計算式・境界・固定期待値 |
| [STORAGE_PROTOCOL](STORAGE_PROTOCOL.md) | 原子的保存・再試行・競合・移行/復元 |
| [ARCHITECTURE](ARCHITECTURE.md) | 現在のモジュール構成とPWA/保存/交換 |
| [TEST_PLAN](TEST_PLAN.md) | 試験範囲・自動/実機対応・リリース基準 |
| [ROADMAP](ROADMAP.md) | 工程の現在位置と将来項目 |
| [CLASSIFICATION](CLASSIFICATION.md) | 要件承認・実装上の選択・将来/未実装の区別 |
| [ISSUE_DRAFTS](ISSUE_DRAFTS.md) | I01〜I10と家族共有のIssue対応表（現在は管理表） |
| [CONTRIBUTING](../CONTRIBUTING.md) | ブランチ/PR、版、データ保護、文書と試験の更新 |
| [CHANGELOG](../CHANGELOG.md) | 仕様/実装/文書変更の履歴 |

## 決定記録と機能詳細

| 文書 | 用途 |
| --- | --- |
| [CARRYOVER_DECISION](CARRYOVER_DECISION.md) | 繰越の原資・正負精算・保留方式の承認記録 |
| [OPERATIONS_DECISION](OPERATIONS_DECISION.md) | UI/通知/定期/CSV/集計期間の承認記録 |
| [FAMILY_SHARING](FAMILY_SHARING.md) | 親子登録/統合・権限・競合・互換性 |
| [CHILD_BUDGET_PREVIEW](CHILD_BUDGET_PREVIEW.md) | 子の仮表示と親確認済み結果の対応 |
| [PARENT_RECOVERY](PARENT_RECOVERY.md) | 初期状態への親バックアップ復旧条件 |
| [FILE_SAVE](FILE_SAVE.md) | JSON/CSV保存・用途識別・共有失敗時の案内 |
| [GOALS](GOALS.md) | 期間別目標・履歴・率/不足額・達成記録 |
| [RECURRING_CSV](RECURRING_CSV.md) | 定期設定/単回確定と2種類のCSV |
| [PWA_IDENTITY](PWA_IDENTITY.md) | PWA識別IDの修正根拠と導入時の検証 |
| [MANIFEST_REFRESH](MANIFEST_REFRESH.md) | manifest取得方式とインストールの確認状態 |

機能詳細の見出しにある版は導入版です。導入時の試験数・未確認記録は、その版の履歴として保持します。現在の状態は上の現行資料を優先します。

## 履歴資料

| 文書 | 記録の対象 |
| --- | --- |
| [TEST_RESULTS_I04](TEST_RESULTS_I04.md) | 0.1.0-devの基盤と過去の受入追記 |
| [TEST_RESULTS_I05](TEST_RESULTS_I05.md) | 0.2.0-devの入力/項目/一覧と過去の受入追記 |
| [TEST_RESULTS_I06](TEST_RESULTS_I06.md) | 0.3.0-devの予算/プールと導入時の受入手順 |
| [TEST_RESULTS_SHARING](TEST_RESULTS_SHARING.md) | 0.4.0-devの家族共有と旧版更新試験 |
| [SOURCE_REGISTER](SOURCE_REGISTER.md) | 移行元ZIP・初回GitHub照合の根拠 |
| [MIGRATION_REVIEW](MIGRATION_REVIEW.md) | 初回比較・当時の仮定/未承認案 |

履歴資料の「今回」「未実装」「未確認」は当時の意味です。現在の要件を旧案へ戻したり、古い合格を最新版全体の合格として使ったりしません。原文の追跡はGitの履歴でも可能です。
