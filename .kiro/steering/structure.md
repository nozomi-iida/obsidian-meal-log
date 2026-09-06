# プロジェクト構成

## 構成方針

アプリケーションコードは `src/` 配下に集約し、ルーティングは Next.js App Router の
ファイルベース規約に従う。
機能が少ないうちは階層を作り込まず、**共有や重複が実際に発生した時点で切り出す**。
先回りして空のディレクトリを用意しない。

## ディレクトリパターン

### App Router（`src/app/`）

**役割**: ルーティングと画面。ディレクトリ名がそのまま URL パスになる。

- `layout.tsx` — 共通レイアウト。`<html>` / `<body>` を持つのはルートレイアウトのみ
- `page.tsx` — 各ルートの画面
- `route.ts` — API エンドポイント（Route Handler）
- `globals.css` — Tailwind の読み込みとデザイントークン定義

### 静的アセット（`public/`）

**役割**: ビルドを通さずそのまま配信されるファイル。
`/next.svg` のようにルート相対のパスで参照する。

## 命名規約

- **ディレクトリ**: kebab-case
- **App Router の予約ファイル**: Next.js 規定の小文字名（`page.tsx` / `layout.tsx` / `route.ts`）
- **コンポーネント**: PascalCase で定義する
- **default export**: ページ・レイアウトなど App Router が要求する箇所のみ。
  それ以外は named export を使う

## import の書き方

```typescript
import { Something } from "@/lib/something"; // src 配下は絶対パス
import { Local } from "./local";             // 同一ディレクトリ内は相対パス
```

**パスエイリアス**

- `@/` → `./src/`

## コード構成の原則

- **サーバーコンポーネント既定**: `"use client"` は状態・イベントハンドラ・ブラウザ API が
  必要な末端コンポーネントにのみ付ける。ページ全体には付けない
- **データ取得はサーバー側**: fetch や I/O はサーバーコンポーネントまたは Route Handler で行い、
  クライアントには結果だけを渡す
