# 技術スタック

## アーキテクチャ

Next.js App Router によるフルスタック構成。サーバーコンポーネントを既定とし、
状態やイベントハンドラが必要な箇所だけをクライアントコンポーネントに切り出す。

## コア技術

- **言語**: TypeScript 5（strict モード）
- **フレームワーク**: Next.js 16（App Router）
- **UI**: React 19
- **スタイル**: Tailwind CSS v4
- **パッケージマネージャ**: pnpm 10.7.1（`package.json` の `packageManager` で固定）

## 主要ライブラリ

- `next/font` — Geist / Geist Mono をセルフホスト。CSS 変数 `--font-geist-sans` /
  `--font-geist-mono` 経由で参照する

## 開発標準

### 型安全性

- `strict: true`。`any` は使わない
- Next.js 16 の型付きルートヘルパー（`LayoutProps<"/">` など）を使い、
  ページ／レイアウトの props を手書きで型定義しない

### コード品質

Biome を使う。ESLint / Prettier は使わない。

Next.js 16 で `next lint` は削除され、`next build` も Lint を実行しない。
公式ドキュメントが Biome または ESLint を直接使うよう案内している。
品質チェックは独立したコマンドとして持つ。

### テスト

Vitest を使う。cc-sdd の `/kiro-impl` は TDD（RED → GREEN）で実装するため、
実装フェーズに入る前に動く状態にしておく。

## 開発環境

### 必要なツール

- Node.js（Next.js 16 の要求バージョン以上）
- pnpm 10.7.1

### 主要コマンド

```bash
pnpm dev     # 開発サーバー起動
pnpm build   # 本番ビルド
pnpm start   # 本番サーバー起動
```

## 主要な技術判断

### Tailwind CSS v4 の CSS-first 設定

`tailwind.config.js` は持たない。`src/app/globals.css` の `@import "tailwindcss"` と
`@theme inline` ブロックでデザイントークンを定義する。
色やフォントを追加するときは JS の設定ファイルではなく globals.css を編集する。

### テーマ切り替え

`prefers-color-scheme` で CSS 変数（`--background` / `--foreground`）を切り替え、
コンポーネント側では Tailwind の `dark:` バリアントを併用する。

### パスエイリアス

`@/*` → `./src/*`。`src` 配下のモジュールは絶対パスで import する。

### データ永続化 — データベースを持たない

食事ログの保存先は GitHub 上の `obsidian-vault` リポジトリ。
GitHub Contents API で `Meals/items/` に Markdown を commit する。
アプリ自身は DB を持たず、読み取り用のキャッシュも持たない。

ファイル名が食べた時刻（`YYYY-MM-DD-HHmm.md`）なので書き込みは常に新規作成になり、
既存ファイルの取得（GET）や sha の受け渡しが不要。**`PUT` 1 発で完結する**。

### プリセットの持ち方

定番メニューと食材の概算値は**アプリ側のソースに持つ**。
vault の `Meals/presets.md` は読まない。GitHub API での取得もビルド時の埋め込みも行わないため、
**読み取り経路そのものが存在しない**。アプリが GitHub に触れるのは書き込みの `PUT` だけ。

vault 側の `presets.md` とは内容が二重になるが、Web アプリ完成後は
`.claude/commands/meal.md` を使わなくなるため、実運用で参照されるのはアプリ側だけになる。

### デプロイ

Vercel。外出先のスマホから記録するため、サーバーからローカルの vault には触れない。
GitHub を経由するのはこの制約が理由。

### 秘匿情報

GitHub のアクセストークンはサーバー側の環境変数に置き、クライアントに渡さない。
コミット処理は Route Handler またはサーバーアクション経由で行う。

### 認証 — proxy による Basic 認証

Next.js の `proxy` で Basic 認証をかける。パスワードは環境変数に置く。

Next.js 16 で `middleware` は `proxy` に改名された。ファイル名は `proxy.ts`、
エクスポートする関数名は `proxy`。**`proxy` のランタイムは nodejs 固定**で、
edge は選べない。これは制約ではなく利点で、認証情報の定数時間比較に
`node:crypto` の `timingSafeEqual` がそのまま使える。

Vercel の Deployment Protection は使わない。Hobby プランで使える Vercel Authentication は
Preview と生成 URL しか保護せず、**本番ドメインは公開のまま**になるため。
Password Protection は Pro + 月 $150 のアドオンか Enterprise が必要。

ブラウザがパスワードを記憶するため、スマホからの利用でも毎回の入力にはならない。

### PWA 化する — Service Worker は入れない

ホーム画面から起動できるようにする。必要なのは manifest とアイコンだけで、
**Service Worker は入れない**。

インストール可能と判定される条件は HTTPS と有効な manifest であり、
Service Worker は必須ではない。Service Worker が要るのはオフライン動作・
バックグラウンド同期・プッシュ通知で、いずれも本アプリでは使わない。
むしろ Basic 認証と併用すると認証ダイアログが表示されなくなる不具合や、
キャッシュにより認証プロンプトが二度と出なくなる問題が報告されているため、
入れない方が安全。

manifest はブラウザが認証情報を伴わずに取得するため、そのままでは
Basic 認証下で 401 になる。`<link rel="manifest" crossorigin="use-credentials">`
を指定して認証情報を送る。

## 着手時に導入するもの

以下は現状の `package.json` に入っていない。最初の spec のタスクに含める。

| 対象 | 用途 |
|---|---|
| Biome | Lint / フォーマット |
| Vitest | テスト |
| proxy（Basic 認証） | 公開 URL の保護 |
| manifest とアイコン | ホーム画面からの起動 |

## 初期スコープ外

写真からの推定手段（どの API / モデルを使うか）は決めない。
機能を追加する時点で決める（`product.md` の「スコープ外」を参照）。
