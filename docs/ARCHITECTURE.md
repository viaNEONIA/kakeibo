# 技術設計 v1.3

## 構成
静的HTML/CSS/JavaScriptのPWA。GitHub Pages等のHTTPSホスティングを想定。Web App Manifest、Service Worker（アプリシェルのオフラインキャッシュ）、IndexedDB（取引・予算・設定）を使用。アプリサーバー不要。

## 原則
- UIと保存処理を分離し、計算ロジックをテスト可能な純粋関数にする。
- IndexedDBバージョン変更は移行処理で対応し、破壊的初期化を禁止。
- Service Worker更新は入力中に強制リロードしない。
- JSONバックアップはスキーマ版、作成日時、全ストア、検証用メタデータを含める。
- CSVはUTF-8 BOM付き、日付はISO形式、金額は数値。セルの数式注入対策を行う。
- ブラウザ保存は永続保証がない。ユーザーによるバックアップ導線を設ける。
- 初期版はサーバー同期・アプリ終了中の確実なプッシュ通知なし。アプリ内通知で対応。

## 初期ディレクトリ案
```
index.html
manifest.webmanifest
sw.js
css/style.css
js/app.js
js/db.js
js/transactions.js
js/budget.js
js/carryover.js
js/recurring.js
js/export.js
js/settings.js
icons/
docs/
```
これは予定構成であり、移行パッケージにアプリ本体は含まない。

## 承認済み運用追補 — 2026-10-19

JSON復元は全量上書きのみ、型・必須値・参照・重複ID/未知新版検証後に原子的置換。不正時は元データを保持し、事前バックアップ導線を設ける。CSVは収支とプールの2種類。対象環境はAndroid Chrome・iOS Safari・PC Chrome/Edge、検証時に版を記録。集計期間定義と日本時間の日付境界を計算処理の共通入力とする。詳細はOPERATIONS_DECISION、期間変更ルールはOPERATIONS_DECISIONで承認済み。

## I03の保存・計算設計

[DATA_MODEL](DATA_MODEL.md)は17ストアとキー/索引/参照、[CALCULATION_SPEC](CALCULATION_SPEC.md)は期間・純支出・精算の入出力、[STORAGE_PROTOCOL](STORAGE_PROTOCOL.md)は原子的更新・再試行・競合・復元・移行を定義する。未精算額は導出値、期間はUUIDで識別する。I03時点ではソースコード・DB雛形を追加していない。I04の実装範囲は後述。

## I04実装

静的シェル、js/schema.js・validation.js・db.js・app.js、sw.jsを実装。DB/バックアップ形式v1、全量復元と競合制御を備える。具体範囲と限界は[IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md)、検証は[TEST_RESULTS_I04](TEST_RESULTS_I04.md)参照。後続の業務コマンドは未実装。
