# 要件・実装・将来項目の区分

仕様の承認、技術実装、受入完了を分けます。現行アプリは0.6.0-dev。初回移行時の推奨案を、現在の承認や実機合格へ読み替えません。

| 区分 | 内容 | 根拠/現状 |
| --- | --- | --- |
| 確定要件 | 5画面、収入/支出/返金、専用テンキー、連続/取消、項目管理、一覧/検索/編集/削除 | SPEC・UI_SPEC・OPERATIONS_DECISION。実装済み |
| 確定要件 | 基本/項目別予算、独立プール、手動配分、正負精算、履歴、未精算保留 | SPEC・CARRYOVER_DECISION。実装済み |
| 確定要件 | 期間開始日1〜28、終了月/実範囲、締め後変更と端数移行 | OPERATIONS_DECISION。既存未来期間の再分割には実装制限あり |
| 確定要件 | 単一目標、適用期間、変更/解除履歴、率/不足額、通知一意 | SPEC・OPERATIONS_DECISION。I07実装済み |
| 確定要件 | 毎月の収入/支出予定、手動単回確定、短月の月末補正 | OPERATIONS_DECISION。I08実装済み |
| 確定要件 | PWA/オフライン/IndexedDB、別CSV、JSONバックアップ/復元 | SPEC。実装済み、Excel/最新版実機は受入中 |
| 承認済み追加 | 同一家計簿の親子JSON交換、並行競合の親優先/子登録順、親専用締め | SPECの家族共有追補。実装済み |
| 技術実装 | 静的HTML/CSS/JS、manifest/SW、17ストア、DB版2、変更DAG、原子的保存 | ARCHITECTURE・DATA_MODEL・STORAGE_PROTOCOL。新しい利用要件の承認とは別 |
| 実装上の範囲 | 管理操作の親集約、画面内達成通知、予定候補の導出/既存pending保持 | 各機能詳細。月締め以外の権限を追加承認扱いにしない |
| 要確認差分 | データ一括削除、入力設定、旧計画のグラフと現行表 | OPEN_QUESTIONS D-01〜D-03。未実装/未定義の扱いを判断 |
| 任意拡張 | 名称履歴候補 | UI_SPEC。未実装 |
| 将来 | 目標達成予定月の推定、クラウド交換 | SPEC・ROADMAP。現行実装対象外 |
| 別途設計 | 稼働中親の移譲、子解除/再登録、定期周期拡張等 | FAMILY_SHARING・RECURRING_CSV。既存の親復旧とは別 |
| 受入 | 過去のI04/I05報告、現行自動試験、未実施の最新版全体確認 | TEST_RESULTS_CURRENT・TEST_CHECKLISTで別管理 |

移行時点の根拠は[SOURCE_REGISTER](SOURCE_REGISTER.md)、現行の資料構成は[INDEX](INDEX.md)を参照。未確定事項を推測で正式仕様にしません。
