# Research & Design Decisions

## Summary

- **Feature**: `meal-record`
- **Discovery Scope**: Complex Integration（外部 API への書き込みを伴う新機能）
- **Key Findings**:
  - **新規作成に `sha` は要らない**。公式が「Required if you are updating a file」と明記しており、`product.md` と `tech.md` の「`PUT` 1 発で完結する」は成立する。**実測で 201 を確認した**
  - **衝突時の応答は 422**。公式は 409 と 422 の両方を列挙してどちらかを明記していなかったため、実測で確定した。本文は `"sha" wasn't supplied.`
  - **fine-grained PAT の `Contents: Read and write` で足りる**。公式は classic token の `repo` スコープしか記載していなかったが、実測で作成と削除の両方が通った
  - **日本語は Base64 往復で壊れない**。全角文字と em dash を含めて一致した

## Research Log

### GitHub Contents API — ファイルの新規作成

- **Context**: `product.md` と `tech.md` が「存在チェックなしの `PUT` 1 発で完結する」と言い切っている。この前提が成立するかを確かめる
- **Sources Consulted**: [GitHub REST API — Repository contents](https://docs.github.com/en/rest/repos/contents)
- **Findings**:
  - エンドポイントは `PUT /repos/{owner}/{repo}/contents/{path}`
  - 必須のボディは `message`（コミットメッセージ）と `content`（**Base64 エンコード**）
  - `sha` は「Required if you are updating a file」。**新規作成では不要**
  - 成功時のステータスは**新規作成が 201、更新が 200** で区別できる
  - 返るステータスは 200 / 201 / 404 / 409 / 422
  - 認証は `Authorization: Bearer <TOKEN>`。あわせて `Accept: application/vnd.github+json` と
    `X-GitHub-Api-Version: 2026-03-10` の指定が推奨されている
- **Implications**:
  - 設計の中核（`PUT` 1 発）は公式に裏付けられた。既存ファイルの取得も `sha` の受け渡しも要らない
  - API バージョンヘッダを明示的に送る。送らないと将来の既定バージョン変更で挙動が変わりうる

### 実測 — vault への `PUT` を 2 回叩く（2026-10-11）

- **Context**: 設計を書き終えた時点で、公式ドキュメントに答えが無い前提が 3 件残っていた。
  タスクを切る前に潰す工程として実測した
- **方法**: `Meals/items/_probe-<PID>.md` へ `sha` なしの `PUT` を 2 回送り、
  GET で読み直してから DELETE で片付けた。トークンは `.env.local` から読み、
  コマンドラインには渡していない
- **Findings**:

  | 確かめたこと | 結果 |
  |---|---|
  | `sha` なしの新規作成 | **201 Created** |
  | 同じパスへ 2 回目の `PUT` | **422**。本文 `{"message": "Invalid request.\n\n\"sha\" wasn't supplied.", "status": "422"}` |
  | fine-grained PAT の `Contents: Read and write` | 作成・取得・削除のすべてが通った |
  | 日本語の Base64 往復 | 一致。`夜` / `鶏もも` / em dash の `—` も壊れていない |
  | `X-GitHub-Api-Version: 2022-11-28` | 受け付けられた |

- **Implications**:
  - **重複の判定は 422 で行う。409 ではない。**
  - 判定はステータスコードだけで決める。応答本文の文面には依存しない。
    文面は GitHub の都合で変わりうるため
  - アプリが生成する要求では、422 は `sha` 不足以外の原因で起きない。
    `message` は常に設定し、`content` は生成した Markdown の Base64、`path` はファイル名から
    組み立てるため、他の検証エラーの余地がない。したがって **422 を無条件に重複として扱う**
  - classic PAT の広い権限は不要。最小権限で成立する
  - 新規作成が 201、更新が 200 で区別できるため、仮に将来 `sha` を送る実装を加えても
    「作ったのか上書きしたのか」を取り違えない

### Next.js 16 のフォーム送信

- **Context**: 記録の送信をどう実装するか。資格情報を端末に渡さない制約（受入基準 7.2）がある
- **Sources Consulted**: Next.js 公式ドキュメント（Server Actions / forms、version 16 upgrade guide）
- **Findings**:
  - Server Action は `'use server'` を付けた関数。`<form action={formAction}>` に渡して呼ぶ
  - React 19 の `useActionState(action, initialState)` が `[state, formAction, pending]` を返す。
    送信中の状態と結果の表示に使える
  - Server Action の第 1 引数は直前の state、第 2 引数が `FormData`
  - 環境変数はサーバーコンポーネントや Server Action の中で `process.env` から直接読める
- **Implications**:
  - 資格情報は Server Action の中でのみ読み、クライアントには結果だけを返す
  - `pending` で受入基準 6.1（送信中の表示と二重送信の防止）を満たせる
  - 失敗時に state を返すことで受入基準 6.4（入力の保持）に近づくが、
    **入力そのものはクライアント側の状態として保持する**必要がある

### Server Action と遮断点の関係

- **Context**: `app-foundation` の design.md が申し送りを残している
  — 「Server Function は独立したルートではなく、それが使われているルートへの POST として
  扱われる。`matcher` の変更や Server Function を別ルートへ移すリファクタによって、
  保護が静かに外れうる。その関数の内部でも認証を検証すること」
- **Findings**:
  - 現在の `matcher` は `/manifest.webmanifest` と `/favicon.ico` 以外のすべてを対象とするため、
    記録画面への POST も遮断点を通る
  - ただしこれは `matcher` の現在の形に依存する。除外が増えれば保護が外れうる
- **Implications**:
  - 多層防御として Server Action の内部でも認証を検証するかは**設計判断**。
    要件には含まれていないため、design で扱い、人の確認を取る

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Server Action 1 本に集約 | フォームから Server Action を呼び、その中で検証・生成・書き込みをすべて行う | ルートが増えない。資格情報がサーバーに留まる | Server Action が肥大化し、テストが HTTP とファイル生成に同時に依存する | 純粋関数へ切り出せば解消する |
| Route Handler を立てる | `/api/meals` に POST する | HTTP の契約が明示的になり、curl で叩ける | ルートが増え、CSRF 対策を自前で考える必要がある。Server Action は Next.js が対策済み | 外部から叩く要件が無いため採らない |
| **採用**: Server Action + 純粋関数 | 判定・算出・生成を HTTP を知らない純粋関数に分け、Server Action は配線だけを持つ | 単体テストが HTTP の組み立てなしに書ける。`app-foundation` の `basic-auth` と同じ構造 | 層が 1 つ増える | steering の「データ取得はサーバー側」とも整合 |

## Design Decisions

### Decision: 算出・推定・生成を HTTP を知らない純粋関数に切り出す

- **Context**: 受入基準 2.x（算出）、3.x（区分の推定）、5.x（ファイルの形）はいずれも
  入力から出力が決まる処理であり、HTTP や外部 API と無関係
- **Alternatives Considered**:
  1. Server Action の中にすべて書く — テストが Server Action の呼び出しに依存する
  2. 純粋関数に切り出す — テストが入出力だけで書ける
- **Selected Approach**: 2。`nutrition` / `meal-time` / `note` を純粋関数として分け、
  Server Action は入力の取り出しと配線だけを持つ
- **Rationale**: `app-foundation` の `basic-auth` が同じ構造で、単体テストが素直に書けた。
  その実績に揃える
- **Trade-offs**: ファイル数が増える。ただし 1 ファイル 1 責務が保たれる
- **Follow-up**: 外部 API を呼ぶ `vault` は純粋関数にできない。ここは実測で担保する

### Decision: 丸めを食材ごとに先に行う

- **Context**: 受入基準 2.5 / 2.6。合計してから丸める方式と、食材ごとに丸めてから足す方式がある
- **Selected Approach**: 食材ごとに整数へ丸め、合計はその和とする
- **Rationale**: 本文に並べた数字を足せば frontmatter の合計になる。Obsidian で手直ししたときに
  検算できる。`product.md` の「後から人が数値を直せるようにする」に合う
- **Trade-offs**: 合計してから丸める方式より誤差が大きい。ただし「精度より継続」の方針では許容範囲
- **Follow-up**: 丸めの方向（四捨五入 / 切り捨て）を design で決める

### Decision: プリセットをソースコードの定数として持つ

- **Context**: `presets.md` が空であり、読み取り経路も存在しない（`tech.md`）
- **Selected Approach**: `src/lib/presets.ts` に食材の配列を持つ。増やすにはデプロイを要する
- **Rationale**: 本 spec の範囲を記録に絞ったため。登録機能は後続の spec
- **Trade-offs**: 食材を増やすたびにデプロイが必要
- **Follow-up**: 初期に何件・どの食材を入れるかは実装時に利用者に確認する

## Risks & Mitigations

- ~~**衝突時のステータスコードが不明**~~ — 実測で 422 と確定（上記）
- ~~**fine-grained PAT で足りない可能性**~~ — 実測で足りることを確認（上記）
- **422 の意味が将来変わる** — 重複を 422 で判定している。GitHub が検証の分類を変えると、
  重複以外の 422 を重複と誤判定する。design.md の Revalidation Triggers に含めた
- **トークンの期限切れ** — fine-grained PAT は期限付き。失効すると記録できなくなる。
  受入基準 6.3 で「権限」の失敗として示し、何をすればよいか分かるようにする
- **プリセットが育たない** — 手入力した食材は保存されないため、よく食べるものを毎回打つことになる。
  登録機能の spec を早めに切る動機になる

## References

- [GitHub REST API — Repository contents](https://docs.github.com/en/rest/repos/contents) — `PUT` の契約、`sha` の必要条件、ステータスコード
- [Next.js — Forms and Server Actions](https://nextjs.org/docs/app/guides/forms) — `useActionState` と Server Action の署名
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — サーバー側での環境変数の扱い
