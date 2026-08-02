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

## Google Sheets連携

1. Googleスプレッドシートを作成します。
2. Apps Scriptを開き、`google-apps-script.js`の内容を貼り付けます。
3. Webアプリとしてデプロイします。
4. 発行された`https://script.google.com/macros/s/.../exec`を画面の`Google Apps Script URL`へ貼ります。
5. `Sheetsへ送信`で行が追加されます。

現在のデフォルトURL:

```txt
https://script.google.com/macros/s/AKfycbxb1kqPApIKDi-9xf0XDsrGWbbBu9fFEkrVTTk6ov_xbxIAaJGZy6l6sl81XUBXdrXR/exec
```
