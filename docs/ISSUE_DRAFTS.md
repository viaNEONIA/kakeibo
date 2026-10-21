# GitHub Issue管理

2026-10-19に登録したIssueの対応表。現在はI04〜I08と家族共有を実装済み、I09の全体受入は未完了です。下表は工程/受入条件であり、GitHub Issueの開閉状態の代用ではありません。実装済みと実機受入完了を区別します。

| ID | タイトル・対象 | 受入条件 | 依存 |
| --- | --- | --- | --- |
| [I01](https://github.com/viaNEONIA/kakeibo/issues/1) | 繰越計算・締め・過去修正の仕様決定 | 既存Q1〜5とR-Q01を決定し、通常/未使用配分/超過/再実行/過去修正の期待額を記載。関連文書同時更新 | 最優先 |
| [I02](https://github.com/viaNEONIA/kakeibo/issues/2) | UI・通知・運用条件の決定 | 既存Q6〜11とR-Q02〜05を決定し、定期収入の初期範囲を明記 | I01と並行検討可 |
| [I03](https://github.com/viaNEONIA/kakeibo/issues/3) | DB物理設計と計算単体仕様 | キー・索引・金額・参照・移行・原子的更新・重複防止を文書化。算術例を固定 | I01・I02 |
| [I04](https://github.com/viaNEONIA/kakeibo/issues/4) | PWA・保存・復元基盤の実装 | 合意環境でオフライン起動・保存・非破壊更新・全量復元・破損拒否を確認 | I03 |
| [I05](https://github.com/viaNEONIA/kakeibo/issues/5) | 入力・項目管理・収支一覧 | 5画面構成、専用テンキー、連続/取消、項目履歴保持、1行一覧/編集削除/フィルターを試験 | [I04](https://github.com/viaNEONIA/kakeibo/issues/4) |
| [I06](https://github.com/viaNEONIA/kakeibo/issues/6) | 予算・繰越プール実装 | 項目別予算・手動配分・月別推移が期待額と一致。再締め重複0・既存履歴無断削除0 | I01・I04・I05 |
| [I07](https://github.com/viaNEONIA/kakeibo/issues/7) | 目標額・履歴・通知実装 | 単一目標の設定変更解除・達成率/不足額・当時目標・通知重複防止を検証。予測月表示なし | I02・I06 |
| [I08](https://github.com/viaNEONIA/kakeibo/issues/8) | 定期支出・CSV/JSON出力 | 未確定予定は実績外、手動で一度確定。短い月の決定規則、CSV Excel読込/数式対策、JSON完全復元を検証 | I02・I04・I05 |
| [I09](https://github.com/viaNEONIA/kakeibo/issues/9) | 初期リリース受入 | Android/iPhone実機と合意PC環境で必須試験合格。重大計算不整合・データ消失・主要操作不能0件。結果とコミット記録 | I04〜I08 |
| [I10](https://github.com/viaNEONIA/kakeibo/issues/10) | 将来: 目標達成予定月の推定 | 将来の仕様決定後に計算方式・データ不足等の受入条件を作成 | 初期実装から除外 |

工程順序: I01/I02→I03→I04〜I08→I09。現在はI09向けの確認段階。mainへは各Issueの受入条件と検証記録をPRで確認してから統合します。

## 追加と現在の確認

[家族共有 #20](https://github.com/viaNEONIA/kakeibo/issues/20)をI06後へ追加し、親子統合・仮表示・初期状態への親復旧を実装。I07はPR #29、I08はPR #30で実装済み。受入は[TEST_CHECKLIST](TEST_CHECKLIST.md)へ記録し、未確認のI06〜I08/共有/復旧/Excelや仕様実装差分を残したまま完了扱いにしません。
