# Simple Web Clipper

URLを貼るだけでGoogle Sheetsへ記録できる小さなWEBクリッパーです。GitHub Pagesで静的ホストできます。

## ローカル起動

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

## GitHub Pagesで使う

GitHub Pagesでは`index.html`、`styles.css`、`app.js`だけで動きます。タイトル、公開日、説明文の取得とSheets更新はGoogle Apps Script側で行います。

1. GitHubへこのリポジトリをpushします。
2. Repository Settings > Pagesで`main`ブランチを公開します。
3. 発行されたURLを開きます。
4. iPhoneショートカットでは以下の形式にします。

```txt
https://<username>.github.io/<repo>/?url=
```

末尾に共有URLを付けます。

タイトルも渡せる場合は、URLエンコードしたタイトルを`title`に付けます。

```txt
https://<username>.github.io/<repo>/?url=<URLエンコード済みURL>&title=<URLエンコード済みタイトル>
```

## Cloudflare Tunnelで使う

Wi-Fiに依存せず使う場合は、パスワード認証付きで起動してからCloudflare Tunnelを使います。

```bash
CLIPPER_PASSWORD='任意のパスワード' node server.js
```

`.env`に保存しておくこともできます。

```bash
cp .env.example .env
```

別ターミナルで公開URLを作ります。

```bash
cloudflared tunnel --protocol http2 --url http://localhost:4173
```

表示された`https://...trycloudflare.com`をiPhoneなどから開きます。ユーザー名は任意、パスワードは`CLIPPER_PASSWORD`に指定した値です。

### 固定URL化

一時URLではなく固定URLにする場合はCloudflareアカウントでログインし、Named Tunnelを作ります。

```bash
cloudflared tunnel login
cloudflared tunnel create simple-web-clipper
cloudflared tunnel route dns simple-web-clipper clipper.example.com
cloudflared tunnel run --url http://localhost:4173 simple-web-clipper
```

`clipper.example.com`は自分のCloudflare管理ドメインのサブドメインに置き換えます。

## Google Sheets連携

1. Googleスプレッドシートを作成します。
2. Apps Scriptを開き、`google-apps-script.js`の内容を貼り付けます。
3. Webアプリとしてデプロイします。
4. 発行された`https://script.google.com/macros/s/.../exec`を画面の`Google Apps Script URL`へ貼ります。
5. `Sheetsへ送信`で行が追加されます。同じ正規化URLが既にある場合は既存行を更新します。
6. スプレッドシート本体のURLを`Google Sheet URL`に入れると、`シートを開く`ボタンから確認できます。

タイトル、公開日、説明文はApps Script側でページのHTMLメタデータから自動取得します。
`site`、`status`、`canonical_source`列がない既存シートでは、次回送信時に自動で列を追加します。`status`の初期値は`unread`です。
`tags`にはドメインに応じて`fashion`、`business`、`learning`、`music`、`social`などを自動付与します。
Webアプリの`リスト更新`から直近のクリップを読み込み、タイトル、URL、タグ、サイト、状態で検索できます。
YouTubeはoEmbedからタイトルを取得し、`video`タグを自動付与します。
WELD MUSICのブログはWordPress APIまたは本文の`entry-title`から記事タイトルを取得します。
Lifehacker Japanは日本語記事タイトルを優先し、`productivity,business`タグを自動付与します。

現在のデフォルトURL:

```txt
https://script.google.com/macros/s/AKfycbxb1kqPApIKDi-9xf0XDsrGWbbBu9fFEkrVTTk6ov_xbxIAaJGZy6l6sl81XUBXdrXR/exec
```

現在のデフォルトシート:

```txt
https://docs.google.com/spreadsheets/d/1LgYhNoS5fJ8GjvSPTbpScQ05P0QKMBwJLsdPtklobUA/edit?gid=1315881697#gid=1315881697
```
