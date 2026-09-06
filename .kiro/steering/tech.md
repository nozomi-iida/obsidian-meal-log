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

### 認証 — middleware による Basic 認証

Next.js の middleware で Basic 認証をかける。パスワードは環境変数に置く。

Vercel の Deployment Protection は使わない。Hobby プランで使える Vercel Authentication は
Preview と生成 URL しか保護せず、**本番ドメインは公開のまま**になるため。
Password Protection は Pro + 月 $150 のアドオンか Enterprise が必要。

ブラウザがパスワードを記憶するため、スマホからの利用でも毎回の入力にはならない。

### PWA 化する

ホーム画面から起動できるようにする。manifest、Service Worker、アイコン一式が必要。

## 着手時に導入するもの

以下は現状の `package.json` に入っていない。最初の spec のタスクに含める。

| 対象 | 用途 |
|---|---|
| Biome | Lint / フォーマット |
| Vitest | テスト |
| middleware（Basic 認証） | 公開 URL の保護 |
| manifest / Service Worker | ホーム画面からの起動 |

## 初期スコープ外

写真からの推定手段（どの API / モデルを使うか）は決めない。
機能を追加する時点で決める（`product.md` の「スコープ外」を参照）。
