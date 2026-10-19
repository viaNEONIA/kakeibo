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
