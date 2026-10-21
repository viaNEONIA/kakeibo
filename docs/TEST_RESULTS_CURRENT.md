# 現在の試験根拠と受入状況 — 0.6.1-dev

## 0.6.1-dev 予算の定期予定表示

対象：本変更のPR head（基点main `d47464d33d2949ea6191efa118c4adb68462a676`）。2026-10-22実行。

| コマンド | 結果 |
| --- | --- |
| `npm test` | 82件合格（未確定予定の集計・確定移行・除外・親子反映を4件追加） |
| `npm run test:browser:recurring-preview` | 新表示4群合格 |
| `npm run test:browser:i06` | 予算/プール8群合格 |
| `npm run test:browser` | 基盤13群合格 |
| `npm run test:browser:sharing` | 共有11群合格 |
| `npm run test:browser:recurring` | 定期/CSV5群合格 |
| **今回の合計** | **123件/群合格** |

環境：Node24.19.0 / fake-indexeddb6.2.6 / Playwright1.64.1 / Chromium153.0.8010.0（Linux）。二つの暦月にまたがる実期間、短月補正、支出項目別/収入別枠、確定時の予定→実績、除外条件、読取のみ、子の親受信済み表示、オフライン・320/412pxを確認。実機受入は未実施。

## 0.6.0-dev実装時の記録（履歴）

対象実装：[PR #30](https://github.com/viaNEONIA/kakeibo/pull/30)、head `8f8d66707cd58428a415edec43031df3d5e2cd42`、main反映 `27762ae5bc1fd0ea4960fca28ff22eb90b612e66`。下表はその実装時に実行した自動試験の整理です。今回の文書整備で全試験を再実行した記録ではありません。

| 実行コマンド | 対象 | 結果 |
| --- | --- | --- |
| `npm test` | 単体・fake-indexeddb、保存/計算/共有/目標/定期/CSV | 78件合格 |
| `npm run test:browser` | 起動/JSON/実IndexedDB/更新/オフライン | 13群合格 |
| `npm run test:browser:sharing` | 親子往復・競合・仮表示 | 11群合格 |
| `npm run test:browser:file-save` | 保存リンク/共有スタブ/非対応/オフライン | 7群合格 |
| `npm run test:browser:goals` | 目標・通知重複・子権限・保持 | 6群合格 |
| `npm run test:browser:recurring` | 定期収入/支出・編集/停止・CSV別出力/保持 | 5群合格 |
| **合計** | Nodeケースとブラウザーの確認群の合計。実機台数ではない | **120件/群合格** |

環境：Node24.19.0 / fake-indexeddb6.2.6 / Playwright1.64.1 / headless Chromium153.0.8010.0（Linux）。ブラウザー試験は組込HTTPサーバーの `/kakeibo/` サブパス。架空データのみ使用。共有APIはスタブで、実際の送信完了の検証ではありません。

## 再検証

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run test:browser:sharing
npm run test:browser:file-save
npm run test:browser:goals
npm run test:browser:recurring
npm run test:browser:recurring-preview
npm run test:browser:i06
```

Chromiumが既にある場合は各コマンドへ `CHROMIUM_PATH=/path/to/chromium` を指定できます。Playwright同梱ブラウザーと別のブラウザーを使った場合はその版も記録します。

### その他の既存スイート

| コマンド | 対象・基点 | 0.6.0-devの上の120集計に含むか |
| --- | --- | --- |
| `npm run test:browser:i05` | 入力・項目・一覧 | 含まない。過去記録はTEST_RESULTS_I05 |
| `npm run test:browser:i06` | 予算/プール | 含まない。I07実装時には8群合格 |
| `npm run test:browser:install` | manifest識別・別スコープ/更新保持 | 含まない。Android実機インストールではない |
| `npm run test:browser:manifest-refresh` | manifestネットワーク/キャッシュ/障害復帰 | 含まない。MANIFEST_REFRESH参照 |
| `npm run test:browser:parent-recovery` | 初期状態への親復旧 | 含まない。PARENT_RECOVERY参照 |
| `npm run test:upgrade` | I04 `919b402fa6970b23ea89e63ebf124cc0373dc0e8` → 現在 | 含まない。基点のgitオブジェクトが必要 |
| `npm run test:upgrade:i06` | I05 `86cb704` → 現在 | 含まない。基点が必要 |
| `npm run test:upgrade:sharing` | I06 `eaacee787b32a30688701c25d5faa1a5070fdf81` → 現在 | 含まない。基点が必要 |

## 実機の確認範囲

| 対象 | 記録済みの範囲 | 最新版全体の判定 |
| --- | --- | --- |
| I04 | iOS/Androidのバックアップ・復元・オフライン再起動/保存・更新後保持、PC Chrome/Edgeの基盤成功報告 | 過去の対象範囲のみ。OS/ブラウザー版は未記録 |
| I05 | 入力/取消/収入/支出/返金、項目、一覧/検索/編集/削除の成功報告 | 過去の対象範囲のみ。全対象端末の版は未記録 |
| インストール | 現在成功確認あり | 再発監視中。恒久解決の保証ではない |
| ファイル交換 | 保存先からJSONを共有できた報告あり。ファイル取り違えは不具合と区別 | 共有全体の合格へは拡大しない |
| アプリ内共有 | 失敗報告あり。保存リンク/ファイルアプリの経路を提供 | 未解決/環境制限 |
| I06〜I08・共有/復旧・Excel | 自動試験と個別報告を保持 | [実機試験リスト](TEST_CHECKLIST.md)で未確認を記録。全体受入は未完了 |

## 未確認と限界

最新版での対象端末全体の実機受入、Excel実製品での読込、Safari/WebKitでの自動試験、実際の容量枯渇、長期のOSストレージ保持、共有シート/送信先アプリ、端末間の未送信データ不存在の保証は含みません。書込失敗の注入は容量枯渇そのものの試験ではありません。

今回の文書整備の検証はMarkdownの参照・ローカルファイル/コマンド/版の照合・期待値の算術確認です。アプリコードと表示版は変更しません。
