# Research & Design Decisions

## Summary

- **Feature**: `app-foundation`
- **Discovery Scope**: Simple Addition（既知の道具を標準的な手順で導入する。ただし新規依存があるため light discovery を実施）
- **Key Findings**:
  - Next.js 16 で `middleware` は `proxy` にリネームされ、ランタイムは **nodejs 固定**になった。steering の「middleware で Basic 認証」という記述は古い
  - `next lint` は削除され、公式ドキュメントが **Biome または ESLint を直接使え**と案内している。Biome の採用は公式の推奨と一致する
  - Next.js は manifest の `<link>` に `crossorigin="use-credentials"` を**自動で付与する**（14 以降）。Basic 認証下の 401 対策として手動設定は不要と見込まれる

## Research Log

### Next.js 16 における middleware の扱い

- **Context**: steering の tech.md に「Next.js の middleware で Basic 認証をかける」と記載していたが、使用中の Next.js が 16.3.4 であるため現行の規約を確認する必要があった
- **Sources Consulted**: [How to upgrade to version 16](https://nextjs.org/docs/app/guides/upgrading/version-16)（公式・16.3.4 版）
- **Findings**:
  - `middleware` というファイル名は deprecated となり、`proxy` にリネームされた。「ネットワーク境界とルーティングに焦点を当てるため」と説明されている
  - 名前付きエクスポート `middleware` も deprecated。関数名を `proxy` にする
  - **`proxy` は `edge` ランタイムをサポートしない。ランタイムは `nodejs` 固定で変更できない**
  - `edge` を使い続けたい場合のみ `middleware` を維持する
  - `skipMiddlewareUrlNormalize` などの設定フラグも `skipProxyUrlNormalize` に改名された
- **Implications**:
  - 本 spec では `proxy.ts` を採用する
  - nodejs ランタイム固定はむしろ好都合。Basic 認証のデコードに `Buffer` や `node:crypto` の `timingSafeEqual` がそのまま使える（edge ランタイムでは使えない）
  - steering の記述を訂正する必要がある

### next lint の削除と Biome

- **Context**: steering で Biome を採用済みだが、Next.js 16 における Lint の位置づけを確認する必要があった
- **Sources Consulted**: [How to upgrade to version 16](https://nextjs.org/docs/app/guides/upgrading/version-16), [Biome Configuration](https://biomejs.dev/reference/configuration/)
- **Findings**:
  - `next lint` コマンドは**削除された**。公式が「Use Biome or ESLint directly」と案内している
  - `next build` は Lint を実行しなくなった。品質チェックは独立したコマンドとして持つ必要がある
  - Biome は `biome.json` 1 ファイルで Lint とフォーマットの両方を設定する
  - `biome check` が検査、`biome check --write` が自動修正を担う
- **Implications**:
  - Biome の採用は公式の推奨と一致しており、追加の正当化を要しない
  - `next build` が Lint を行わない以上、Requirement 1 の検査コマンドは独立して用意する必要がある

### Basic 認証下での PWA インストール

- **Context**: requirements のレビューで、Req 3-4「すべての経路を認証対象」と Req 4-1「ホーム画面への追加情報を提供」の衝突が指摘された
- **Sources Consulted**:
  - [Progressive Web Apps behind Basic Auth](https://thatemil.com/blog/pwa-basic-auth/)
  - [Manifest file - 401 unauthorized（vercel/next.js Discussion #62867）](https://github.com/vercel/next.js/discussions/62867)
  - [Remove crossorigin from manifest link tag（Discussion #65964）](https://github.com/vercel/next.js/discussions/65964)
  - [Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria)
- **Findings**:
  - manifest はブラウザが認証情報を伴わずに取得するため、Basic 認証下では 401 になる。`crossorigin="use-credentials"` の指定で認証情報が送られるようになる
  - **Next.js 14 以降、生成される manifest の `<link>` に `crossorigin="use-credentials"` が自動で付与される**という報告が複数ある（逆に「外したい」という要望が Discussion に上がっているほど）
  - Service Worker はインストール可能の必須条件ではない。HTTPS と有効な manifest で足りる
  - Service Worker を Basic 認証と併用すると、認証ダイアログが表示されない不具合や、キャッシュにより認証プロンプトが二度と出ない問題が報告されている
- **Implications**:
  - **Service Worker を導入しない**方針とする。オフライン動作・バックグラウンド同期・プッシュ通知はいずれも本アプリのスコープ外であり、導入する利益がない
  - manifest の crossorigin は Next.js が自動付与するため、追加の実装を要さない見込み。ただし公式ドキュメントには明記がないため、実機確認での検証項目とする
  - 結果として Req 3-4 を緩める必要はなくなった

### Vitest の導入構成

- **Context**: cc-sdd の `/kiro-impl` が TDD で動作するため、テスト基盤が必要
- **Sources Consulted**: [Testing: Vitest | Next.js](https://nextjs.org/docs/app/guides/testing/vitest)
- **Findings**:
  - 必要な依存は `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`
  - `vitest.config.ts` で `environment: 'jsdom'`、`globals: true`、`setupFiles` を設定する
  - パスエイリアス `@` は vitest 側でも別途解決の設定が要る
- **Implications**:
  - Requirement 2-5「テストが 1 件も存在しない状態でも異常終了しない」は `--passWithNoTests` で満たす
  - ただし導入直後にテストが 0 件だと基盤が機能しているか確認できない。認証ロジックを純粋関数として切り出し、その単体テストを最初のテストとする

### 実行環境の確認

- **Context**: Next.js 16 は Node.js 20.9+ / TypeScript 5.1+ を要求する
- **Findings**: Node.js 22.23.0 / pnpm 10.7.1 / TypeScript 5.9.3 — いずれも要件を満たす
- **Implications**: ランタイムに起因する追加作業は不要

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 認証ロジックを proxy に直書き | `proxy.ts` の中で完結させる | ファイル数が最小 | テストに Request の構築が必要になり、Requirement 2 を満たす最初のテストが書きにくい | 不採用 |
| 認証判定を純粋関数に分離 | 検証ロジックを `src/lib/` に切り出し、`proxy.ts` が呼ぶ | 単体テストが素直に書ける。テスト基盤の動作確認を兼ねられる | ファイルが 1 つ増える | **採用** |
| 認証ライブラリの導入 | `nextjs-basic-auth-middleware` 等を使う | 実装量ゼロ | Next.js 16 の `proxy` 対応が不明。数十行のために依存を増やす | 不採用 |

## Design Decisions

### Decision: `middleware` ではなく `proxy` を採用する

- **Context**: Next.js 16 で規約が変わった
- **Alternatives Considered**:
  1. `middleware.ts` のまま書く — deprecated 警告が出るが動作はする。edge ランタイムが使える
  2. `proxy.ts` に従う — 公式の現行規約
- **Selected Approach**: `proxy.ts` を採用する
- **Rationale**: 新規プロジェクトであり、deprecated な規約から始める理由がない。edge ランタイムを必要とする要件もない
- **Trade-offs**: nodejs ランタイム固定になるが、Basic 認証では `node:crypto` の `timingSafeEqual` が使えるため利点の方が大きい
- **Follow-up**: steering の tech.md を訂正する

### Decision: Service Worker を導入しない

- **Context**: PWA には Service Worker が必要という前提が steering に書かれていた
- **Alternatives Considered**:
  1. Service Worker を導入する — オフライン対応が可能になる
  2. manifest のみ — インストールは可能。オフラインは不可
- **Selected Approach**: manifest のみ
- **Rationale**: オフラインでの記録は Out of scope であり、Service Worker の 3 用途がいずれも不要。加えて Basic 認証との既知の不具合を回避できる
- **Trade-offs**: 通信できない環境ではアプリが開かない。ただし記録先が GitHub である以上、通信は必須なので実質的な損失はない
- **Follow-up**: なし

### Decision: 認証情報の比較に定数時間比較を用いる

- **Context**: Basic 認証の検証で単純な文字列比較を行うとタイミング攻撃の余地が残る
- **Selected Approach**: `node:crypto` の `timingSafeEqual` を用いる。長さが異なる場合は先に固定長へハッシュ化してから比較する
- **Rationale**: `proxy` が nodejs ランタイムのため利用可能。数行で実装でき、コストがない
- **Trade-offs**: なし
- **Follow-up**: 単体テストで正常系・異常系の双方を検証する

### Decision: 環境変数が未設定なら起動を失敗させる

- **Context**: `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` が未設定のときの挙動を決める必要がある
- **Alternatives Considered**:
  1. 認証をスキップして通す — 開発時は楽だが、設定漏れのまま公開すると無防備になる
  2. すべての要求を拒否する — 安全だが原因が分かりにくい
  3. 明示的なエラーを投げる — 原因が分かり、かつ通過させない
- **Selected Approach**: 3。未設定を検知したら例外を投げ、メッセージで不足している変数名を示す
- **Rationale**: Requirement 3 の目的は「第三者に書き込み経路を渡さない」こと。設定漏れが静かに通る設計は目的に反する
- **Trade-offs**: 開発を始めるのに `.env.local` の用意が必須になる。`.env.local.example` を用意して緩和する

## Risks & Mitigations

- **manifest の crossorigin が期待通り付与されない** — 公式ドキュメントに明記がなく、報告ベースの情報に依存している。実装後、生成された HTML の `<link rel="manifest">` を実際に確認する。付与されていなければ `layout.tsx` で手動の `<link>` を出力する
- **iOS Safari が crossorigin を尊重しない可能性** — iOS の PWA 実装は独自であり、同じ挙動になる保証がない。実機確認で判明した場合は、manifest とアイコンのパスのみ `proxy` の対象外にする。中身のないファイルなので公開されても実害はない
- **Biome の既定ルールが既存コードと衝突する** — `create-next-app` が生成した `layout.tsx` / `page.tsx` に多数の違反が出る可能性がある。導入時に一度 `--write` で整形し、その差分を独立したコミットに分離する

## References

- [How to upgrade to version 16 | Next.js](https://nextjs.org/docs/app/guides/upgrading/version-16) — `middleware` → `proxy`、`next lint` 削除、Turbopack 既定化
- [manifest.json | Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest) — `app/manifest.ts` の規約と `MetadataRoute.Manifest` 型
- [Testing: Vitest | Next.js](https://nextjs.org/docs/app/guides/testing/vitest) — Vitest の導入手順
- [Configuration | Biome](https://biomejs.dev/reference/configuration/) — `biome.json` のスキーマ
- [Revisiting Chrome's installability criteria](https://developer.chrome.com/blog/update-install-criteria) — Service Worker がインストール要件でないこと
- [Progressive Web Apps behind Basic Auth](https://thatemil.com/blog/pwa-basic-auth/) — manifest の 401 と `crossorigin` による解決
- [Manifest file - 401 unauthorized（Discussion #62867）](https://github.com/vercel/next.js/discussions/62867) — Next.js における同事象の報告
