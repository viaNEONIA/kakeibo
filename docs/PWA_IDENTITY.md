# PWA識別IDの修正 — 0.4.1-dev

> 本書の見出しの版・導入時の試験数は導入時点の記録です。現行版と実装状況は[IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md)、受入手順は[TEST_CHECKLIST](TEST_CHECKLIST.md)、文書一覧は[INDEX](INDEX.md)を参照。

## 公開コードの調査結果

2026-10-20 14:46〜14:47 JSTに公開ファイルをHTTP GETで確認。manifestとsw.jsはHTTP200で取得でき、main 13cbdde2ed2c4ec24336b9834361445a09a950bdと同じ設定だった。

| 対象 | 修正前の値 | 実際の解決先 |
| --- | --- | --- |
| 家計簿manifest URL | /kakeibo/manifest.webmanifest | https://vianeonia.github.io/kakeibo/manifest.webmanifest |
| 家計簿id | ./ | https://vianeonia.github.io/ |
| 家計簿start_url / scope | ./ | https://vianeonia.github.io/kakeibo/ |
| SW script / scope | ./sw.js（デフォルトscope） | /kakeibo/sw.js / /kakeibo/ |
| StockLite公開manifest | idなし・start_url/scopeは ./ | 既定ID /stocklite/ |

idはmanifest URLのフォルダーではなくstart_urlの**オリジン**を基準に解決する。start_urlとscopeの相対指定はmanifest URLが基準なので、この違いを混同していた。家計簿idはドメイン直下の他アプリと衝突する可能性がある設定だった。
ただし、上表のStockLiteのIDとは異なる。StockLiteとの直接のID衝突や、Android Chromeの「インストール済み」表示の原因がこの不備だけであることは確認していない。特定のChromium不具合との同一性も未確認。

参照:
- [W3C id処理](https://www.w3.org/TR/appmanifest/#id-member): start_urlのoriginをbaseとし、idを処理する。
- [Chrome公式のPWA識別](https://developer.chrome.com/docs/capabilities/pwa-manifest-id): ID変更は別アプリの識別につながる。既存インストールの計算済みIDを確認することを推奨。

## 修正範囲

idを `/kakeibo/` へ変更する。start_url/scopeは `./` のまま維持。固定のデプロイ先 /kakeibo/ をPWAの識別として使用するので、別パスでの配信へ変更する場合には識別方針も再確認する。SWキャッシュをv4→v5へ更新し、新manifestをアプリ資産とともに保存する。
IndexedDB名/版、通常データ、共有家計簿ID、端末ID、バックアップ形式は変更しない。SWの登録/制御範囲とキャッシュ削除の接頭辞も維持。別アプリのSW登録解除やキャッシュ削除は行わない。

## 検証

`npm run test:browser:install` は組込HTTPサーバー上の /kakeibo/ と、同一オリジンの /stocklite/ を模した**試験用ページ**を使用し、Chromium DevTools ProtocolのPage.getAppManifestが返す処理済みmanifestを確認する。Android実機や公開StockLiteのインストールを操作する試験ではない。

1. 修正前id `./` がオリジン直下へ解決されることを実Chromiumで再現。
2. 明示idのない別パスの試験用アプリが、そのstart_urlをIDにすることを確認。
3. 家計簿SWが別パスのページを制御しないことを確認。
4. 旧manifestをキャッシュした状態から明示更新し、idだけが /kakeibo/ になり、start_url/scopeは同じであることを確認。
5. 設定と取引を含む全IndexedDBレコードが更新前後で完全一致し、別アプリ用の試験キャッシュも保持されることを確認。
6. オフライン再起動後も修正したIDと保存データを使用できることを確認。

環境: Chromium153.0.8010.0 / Playwright1.64.1 / Node24.19.0。6項目合格。基盤13項目とNode51件も回帰確認。これらはAndroid WebAPKのインストール成功を意味しない。

## 配信後の確認手順

1. ブラウザーで https://vianeonia.github.io/kakeibo/#settings を開く。
2. 更新案内が出たら、未保存入力を保存してからアプリの更新操作を行う。設定の表示バージョンが最新版（現在0.6.0-dev）であることを確認する。公開配信/CDNやChrome自身のmanifestキャッシュには反映待ちが発生し得る。
3. 念のためJSONバックアップを端末外にも保存する。
4. Chromeの「ホーム画面に追加」から追加・起動を確認する。Android WebAPK側の成否は実機で判定する。
5. 改善しない場合は、Chromeの正確なバージョンと、処理済みmanifestのID・start_url・scopeを確認してブラウザー側と切り分ける。アプリがWebで動く間はそのまま利用できる。

サイトデータ/Chromeストレージの消去や、同一オリジンの別アプリのアンインストールを対処手順には含めない。IndexedDBのデータを失うおそれがある。
以前のIDで既にインストール済みの端末では、修正後は別アプリ扱いになる可能性がある。再追加や旧アイコン整理はバックアップを保存してから行う。ID変更だけでChrome内部の既存登録が修復されるとは保証しない。

## manifestの配信方式の改善 — 0.4.3-dev

ID修正後も、インストールの成否を識別IDだけで説明できるとは限らない。旧方式はmanifestも版別キャッシュから優先配信し、ネットワーク上の更新を取得しないため、0.4.3-devからmanifestだけをネットワーク優先へ変更する。識別ID自体は/kakeibo/のまま維持し、ID変更を繰り返す対処はしない。
詳細と検証は[MANIFEST_REFRESH](MANIFEST_REFRESH.md)参照。この変更はAndroid Chrome内部のインストール判定を直接修復するものではなく、WebAPKでの改善確認は未実施。
