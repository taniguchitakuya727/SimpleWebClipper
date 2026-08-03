# Simple Web Clipper

URLを貼るだけでObsidian向けMarkdownを作成する小さなローカルWEBクリッパーです。

## 起動

```bash
node server.js
```

Chromeで開きます。

```txt
http://localhost:4173/
```

同じWi-FiのiPhoneからは、MacのLAN IPで開きます。

```txt
http://<MacのIP>:4173/
```

## 外部から使う

Wi-Fiに依存せず使う場合は、パスワード認証付きで起動してからCloudflare Tunnelを使います。

```bash
CLIPPER_PASSWORD='任意のパスワード' node server.js
```

別ターミナルで公開URLを作ります。

```bash
cloudflared tunnel --url http://localhost:4173
```

表示された`https://...trycloudflare.com`をiPhoneなどから開きます。ユーザー名は任意、パスワードは`CLIPPER_PASSWORD`に指定した値です。

## Google Sheets連携

1. Googleスプレッドシートを作成します。
2. Apps Scriptを開き、`google-apps-script.js`の内容を貼り付けます。
3. Webアプリとしてデプロイします。
4. 発行された`https://script.google.com/macros/s/.../exec`を画面の`Google Apps Script URL`へ貼ります。
5. `Sheetsへ送信`で行が追加されます。
6. スプレッドシート本体のURLを`Google Sheet URL`に入れると、`シートを開く`ボタンから確認できます。

現在のデフォルトURL:

```txt
https://script.google.com/macros/s/AKfycbxb1kqPApIKDi-9xf0XDsrGWbbBu9fFEkrVTTk6ov_xbxIAaJGZy6l6sl81XUBXdrXR/exec
```

現在のデフォルトシート:

```txt
https://docs.google.com/spreadsheets/d/1LgYhNoS5fJ8GjvSPTbpScQ05P0QKMBwJLsdPtklobUA/edit?gid=1315881697#gid=1315881697
```
