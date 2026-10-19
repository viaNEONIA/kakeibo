# 簡易家計簿 PWA — 開発管理移行パッケージ

- 基準仕様: v1.3（2026-10-19時点）
- 状態: 設計段階、アプリ本体未実装
- 管理原則: GitHubのmainを検証済み正本とする。ChatGPT Workは実装・検証、通常チャットは仕様検討。
- このパッケージは**移行用の仕様・管理資料**であり、稼働するアプリではない。

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

初回レビューでは未解決16件でした。2026-10-19の承認で6件を解決し保留方式1件を分離、現在は未解決11件です。詳細はMIGRATION_REVIEW参照。過去版それぞれの全文照合は未完了ですが、版別変更内容は添付CHANGELOGから確認できました。以前の推測不足版の管理資料より、本パッケージを優先します。
正本リポジトリ: https://github.com/viaNEONIA/kakeibo 。2026-10-19にmainの15文書をレビュー版と照合し一致を確認しました。ZIPは移行時点のスナップショットであり、今後はGitHubを唯一の正本として更新します。

## 現在の作業状態

- Issue #1〜#10を登録。対応表は[Issue管理](docs/ISSUE_DRAFTS.md)を参照。
- 未確定は11件。繰越計算の承認済み内容と保留案は[決定記録](docs/CARRYOVER_DECISION.md)を参照。最優先は[繰越計算・締め・過去修正](https://github.com/viaNEONIA/kakeibo/issues/1)。
- 初期実装は未着手。将来の目標達成予定月推定は初期リリース対象外。
- 管理整備の変更はdocs/github-management-setupからPRで確認しmainへ統合する運用。
