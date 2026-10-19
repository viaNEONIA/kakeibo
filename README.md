# 簡易家計簿 PWA — 開発管理移行パッケージ

- 基準仕様: v1.3（2026-10-19時点）
- 状態: I04基盤実装済み（0.1.0-dev）。収支入力・予算等は後続工程。
- 管理原則: GitHubのmainを検証済み正本とする。ChatGPT Workは実装・検証、通常チャットは仕様検討。
- 現在は保存・バックアップ/復元・オフライン起動を確認できる基盤版です。完成した家計簿ではありません。

## ドキュメント
- `docs/SPEC.md` 正式仕様
- `docs/UI_SPEC.md` 画面と操作
- `docs/DATA_MODEL.md` データ構造・計算規則
- `docs/ARCHITECTURE.md` PWA技術構成
- `docs/TEST_PLAN.md` 受入試験
- `docs/ROADMAP.md` 開発計画と将来機能
- `docs/OPEN_QUESTIONS.md` 未確定・要確認事項
- `docs/WORK_HANDOVER.md` Workへの初回指示
- `CHANGELOG.md` 仕様変更履歴

## 移行手順
1. GitHubで空リポジトリを作成し、資料をmainへ登録。
2. Workにリポジトリと`docs/WORK_HANDOVER.md`を渡す。
3. Workは最初に仕様レビューとIssue化のみ実施し、承認前にアプリを実装しない。
4. 未確定事項を解消し、実装ブランチで開発・試験。合格後にmainへ統合。

## 移行レビュー追補（2026-10-19）
添付移行パッケージの10文書を基準に、原文を保持してレビュー資料を追加した文書整備版docs-review-1です。アプリ版の更新ではありません。

- [レビューと計算例](docs/MIGRATION_REVIEW.md)
- [開発Issue案](docs/ISSUE_DRAFTS.md)
- [根拠と照合記録](docs/SOURCE_REGISTER.md)
- [区分と未承認提案](docs/CLASSIFICATION.md)
- [変更管理](CONTRIBUTING.md)

初回レビューでは未解決16件でした。2026-10-19の承認で6件を解決し保留方式1件を分離、保留方式も承認済みとなり、旧残10件の承認後、追加の集計期間詳細2件も承認済みで、登録済み未確定は0件です。詳細はMIGRATION_REVIEW参照。過去版それぞれの全文照合は未完了ですが、版別変更内容は添付CHANGELOGから確認できました。以前の推測不足版の管理資料より、本パッケージを優先します。
正本リポジトリ: https://github.com/viaNEONIA/kakeibo 。2026-10-19にmainの15文書をレビュー版と照合し一致を確認しました。ZIPは移行時点のスナップショットであり、今後はGitHubを唯一の正本として更新します。

## 現在の作業状態

- Issue #1〜#10を登録。対応表は[Issue管理](docs/ISSUE_DRAFTS.md)を参照。
- 登録済み未確定は0件。繰越計算と保留方式の承認済み内容は[決定記録](docs/CARRYOVER_DECISION.md)を参照。[繰越計算・締め・過去修正](https://github.com/viaNEONIA/kakeibo/issues/1)は本変更のmain反映で仕様決定完了。[UI・通知・運用条件](https://github.com/viaNEONIA/kakeibo/issues/2)も仕様決定完了です。
- I04基盤を実装済み、収支・予算等は未着手。将来の目標達成予定月推定は初期リリース対象外。
- 管理整備の変更はdocs/github-management-setupからPRで確認しmainへ統合する運用。

## UI・運用・期間設定の決定

[OPERATIONS_DECISION](docs/OPERATIONS_DECISION.md)に承認内容・受入条件を整理。集計期間設定の境界と利用途中変更も承認済み。Issue #2は本変更のmain反映で仕様決定として完了。Issue #3の物理設計・計算仕様は本変更で文書化。本体はI04基盤を実装済み（業務UIは未実装）です。

## I03設計資料

- [データ物理設計](docs/DATA_MODEL.md): 17ストア、期間ID、索引、制約。
- [計算単体仕様](docs/CALCULATION_SPEC.md): 期間・返金・再精算・固定数値例。
- [保存プロトコル](docs/STORAGE_PROTOCOL.md): 原子的更新、重複防止、2タブ競合、全量復元、版移行。

I03は設計文書の工程。I04の基盤実装・DB試験は後述。実機試験は未実施です。

## 基盤の起動と検証

[実装状態と起動手順](docs/IMPLEMENTATION_STATUS.md)、[I04試験結果](docs/TEST_RESULTS_I04.md)を参照。npm ci → npm test、npm run serveでローカル起動できます。通常利用は外部パッケージ不要。Android/iPhone実機試験は未実施です。
