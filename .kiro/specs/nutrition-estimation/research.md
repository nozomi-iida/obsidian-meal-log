# Research & Design Decisions

## Summary

- **Feature**: `nutrition-estimation`
- **Discovery Scope**: Extension（既存の記録経路に推定を挟む）+ 外部 API の新規統合
- **Key Findings**:
  - **`fetch` だけで呼べる。** `@anthropic-ai/sdk` は不要で、`vault.ts` と同じ「`fetch` + ステータスコードで分類」の形にできる。`meal-record` と `app-foundation` の design が定めた「実行時依存は追加しない」を守れる
  - **構造化出力（`output_config.format`）が GA で、文法制約サンプリングによりスキーマ違反が原理的に出ない。** `kcal` / `protein` を nullable にすることで「**分からない**」を構造的に合法な出力にできる。これが「黙って嘘の値を返す」ことへの最強の防御になる
  - **`content[0]` を読んではいけない。** Haiku 5.5 はアダプティブ思考が既定 ON で、`content` の先頭に `thinking` ブロックが入りうる
  - **拒否は HTTP 200 で返る。** `stop_reason: "refusal"` を見ないと `content` が空のまま進む
  - **スキーマで数値の下限（`minimum`）と配列の件数（`minItems` は 0/1 のみ）を縛れない。** 非負の検証と件数の突き合わせはアプリ側に残る
  - **コストは論点にならない。** Haiku 5.5 は 10 万トークン以下なら $0.10/$0.50 per MTok。1 回約 $0.00034（0.05 円）、月 120 回で 6 円程度
  - **Vercel Hobby のタイムアウトは 300 秒。** 以前知られていた 10 秒 / 60 秒ではない。切られる心配はないが、ハングを利用者に待たせないため自前のタイムアウトが要る

## Research Log

### Messages API を `fetch` で呼ぶ

- **Context**: `meal-record` と `app-foundation` の design が「実行時依存は追加しない。`dependencies` は `next` / `react` / `react-dom` のみ」と定めている。SDK を入れずに済むかを確かめる
- **Sources Consulted**: [Messages API](https://platform.claude.com/docs/en/api/messages), [Versioning](https://platform.claude.com/docs/en/api/versioning), [Errors](https://platform.claude.com/docs/en/api/errors)
- **Findings**:
  - エンドポイントは `POST https://api.anthropic.com/v1/messages`
  - 必須ヘッダは `x-api-key` / `anthropic-version` / `content-type: application/json`
  - **`anthropic-version` に指定すべき値は `2023-06-01`。** 存在する値は `2023-06-01` と `2023-01-01`（初期リリース、deprecated）の 2 つだけで、日付を上げる必要はない
  - API リファレンスのヘッダ表は `anthropic-version` を optional と書いているが、versioning のページは "you must send an `anthropic-version` request header" と書いている。**記述が食い違っているので常に送る**
  - 必須のボディは `model` / `max_tokens` / `messages` の 3 つ
  - **`temperature` / `top_p` / `top_k` は送ってはいけない。** Haiku 5.5 では既定値以外を送ると 400
- **Implications**:
  - `src/lib/vault.ts` と同じ構造で書ける。新しい依存を入れない
  - API バージョンはヘッダで明示する。送らないと将来の既定変更で挙動が変わりうる（`vault.ts` で `X-GitHub-Api-Version` を明示したのと同じ理由）

### 応答から文字列を取り出す経路の罠

- **Context**: `content` の配列から推定結果の JSON を取り出す
- **Findings**:
  - **Haiku 5.5 はアダプティブ思考が既定で ON**、`display` の既定値は `"omitted"`
  - そのため `content` の先頭に **text が空の `thinking` ブロックが入りうる**
  - `content[0].text` を読むと空文字になる
- **Implications**:
  - **必ず型で絞り込む**: `content.find((b) => b.type === "text")?.text`
  - 思考トークンは `max_tokens` を消費する。これがレイテンシの主因になる

### エラーの分類

- **Sources Consulted**: [Errors](https://platform.claude.com/docs/en/api/errors)
- **Findings**:

  | 分類 | 検出方法 |
  |---|---|
  | 認証の失敗 | `401` `authentication_error`（キーが不正・revoke 済み・期限切れ） |
  | 課金の問題 | `402` `billing_error` |
  | 権限の不足 | `403` `permission_error` |
  | リクエストの不正 | `400` `invalid_request_error` / `413` `request_too_large` |
  | レート制限 | `429` `rate_limit_error` |
  | 通信の失敗 | `fetch` の throw / `500` `api_error` / `504` `timeout_error` / `529` `overloaded_error` |

  - **401 / 402 / 403 は意味が違う。** `vault.ts` は GitHub API 向けに 401/403 をまとめて `permission` にしているが、Claude API では 401 = キー自体が無効、402 = 課金の問題、403 = キーにリソース権限がない
  - **拒否は HTTP 200 で返る。** `stop_reason: "refusal"` + `stop_details.category`。Haiku 5.5 には server-side fallback がないので再送しても普通はまた拒否される
  - **`stop_reason: "max_tokens"` なら JSON が途中で切れている**
  - 429 には通常 `retry-after` が付くが、月次上限に当たった 429 には付かず再試行しても回復しない
- **Implications**:
  - **ステータスコードだけでは足りない。** `content` を読む前に `stop_reason` を見る
  - 残高切れを「キーが無効」と表示すると原因が分からなくなるため、少なくとも 401 / 402 / 403 は分ける

### 構造化された出力

- **Context**: 食材が複数あるので 1 回の呼び出しで複数の値を返させたい。パースが壊れない形を選ぶ
- **Sources Consulted**: [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)
- **Findings**:
  - **`response_format` というパラメータは存在しない。** 相当する機能の正式名は `output_config.format`
  - `output_format`（トップレベル）は deprecated。新規コードでは使わない
  - **GA、beta ヘッダ不要。`claude-haiku-5-5` は対応モデルに明記されている**
  - 仕組みは **grammar-constrained sampling**（文法制約サンプリング）。トークンのサンプリング自体をスキーマに合う出力だけに制限するため、**スキーマに合わない JSON が出てくることが原理的にない**
  - 結果は `tool_use` ではなく **`text` ブロック**に JSON 文字列として入る

  | 方法 | スキーマ適合の保証 | 評価 |
  |---|---|---|
  | `output_config.format` | **あり**（文法制約） | **最も壊れにくい** |
  | Tool use + `strict: true` | あり（同じ文法エンジン） | 用途は「関数の引数を型安全にする」こと。JSON が欲しいだけなら遠回り |
  | プロンプトで JSON を要求 → `JSON.parse` | **なし** | 前置き文や ```json フェンスが混ざる。最も脆い |

  - 公式も両者を住み分けている: 構造化出力は「最終応答の形式」、strict tool use は「ツール名と入力パラメータ」
- **スキーマの制約（設計に影響する）**:
  - オブジェクトの `additionalProperties` は **`false` 必須**
  - **数値の制約（`minimum` / `maximum` / `multipleOf`）が未対応** → `kcal >= 0` をスキーマで縛れない
  - **配列の `minItems` は 0 か 1 のみ**（`maxItems` なし）→ 「必ず 3 件返せ」を縛れない
  - 文字列の制約（`minLength` / `maxLength`）が未対応
  - 使えるもの: `enum` / `const` / `anyOf` / `allOf` / 内部 `$ref` / `$defs` / `default` / `required` / 文字列 `format`
  - 上限: 任意プロパティ 24 個、`anyOf` を使うプロパティは 16 個まで
- **Implications**:
  - **`kcal` / `protein` を `anyOf: [number, null]` にする。** これが「分からないと言わせる」仕掛けそのものである
  - **非負の検証と件数の突き合わせはアプリ側に残る。** スキーマで縛れない部分がそこに全部来る
  - トップレベルを配列にできるかは公式に記述がないため、`{ items: [...] }` のオブジェクトで包む
  - スキーマは文法にコンパイルされ最終使用から 24 時間キャッシュされる。構造を変えるとキャッシュ無効
  - Haiku 5.5 のプロンプトキャッシュ最小長は 512 トークン。短いシステムプロンプトでは効かないので期待しない

### パースの失敗をどう扱うか

- **Findings**: 文法制約があるので「スキーマに合わない JSON」は来ないが、**途中で切れた JSON は来る**。公式が挙げる 2 つの経路は `stop_reason: "max_tokens"` と `stop_reason: "refusal"`
- **Implications**: 次の順で確かめる
  1. `stop_reason` を見る（`end_turn` 以外は失敗として扱う）
  2. `content` から `type === "text"` を取り出す（なければ失敗）
  3. `JSON.parse` を try/catch で囲む
  4. **パース後も必ずアプリ側で検証する** — 件数が入力と一致するか、値が有限の非負数か
  5. どこかで失敗したら「推定できなかった」として扱い、**ゼロや適当な値で埋めない**

### モデルの選択

- **Sources Consulted**: [Models overview](https://platform.claude.com/docs/en/models/overview), [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **Findings**:

  | モデル | ID | 価格 $/MTok（入力 / 出力） | 相対レイテンシ |
  |---|---|---|---|
  | Claude Fable 5.1 | `claude-fable-5-1` | 10 / 50 | Slower |
  | Claude Opus 5.5 | `claude-opus-5-5` | 4 / 20 | Moderate |
  | Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2 / 10 | Fast |
  | **Claude Haiku 5.5** | **`claude-haiku-5-5`** | **0.10 / 0.50** | **Fastest** |

  - **Haiku 5.5 だけプロンプト長で価格が変わる**: 10 万トークン以下なら $0.10 / $0.50、超えると $0.50 / $2.50。本 spec は数百トークンなので常に安いほう
  - ID に日付サフィックスは付かない（`claude-haiku-5-5-20261007` のような文字列は存在しない）
  - 公式の Haiku 5.5 の位置づけが用途に一致する: "high-volume, latency-sensitive tasks such as **classification, extraction**, and routing"
  - effort の既定は `medium`。`thinking: {"type": "disabled"}` を受け付けるが **effort が `low` / `medium` / `high` のときだけ**（`xhigh` / `max` との併用は 400）
- **コストの見積もり**:
  ```
  システムプロンプト 400 トークン + 食材名 30 トークン ≈ 入力 430
  出力（思考込み）600

  1 回        約 $0.00034（0.05 円）
  月 120 回   約 $0.04（6 円）
  ```
- **Implications**:
  - **コストは選択の決め手にならない。** Sonnet 5.5 でも 1 回 1 円程度
  - **決め手は精度。** Haiku 5.5 で足りるかは実測で確かめる
  - 速度を上げるには `effort: "low"` + 思考 OFF。ただし公式は「思考を切るとユーザーに見えるテキストに推論っぽい文章が混ざる挙動が増える」と明記している

### 推定の精度を上げる書き方

- **Sources Consulted**: [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations), [Prompting Claude Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)
- **Findings**:
  - 公式が挙げる幻覚対策のうち本 spec で使えるのは **"Allow Claude to say 'I don't know'"** と **"External knowledge restriction"** の 2 つ。残り 2 つ（直接引用による grounding、引用による検証）は参照文書がないため使えない
  - **`note` に「段階的な理由」を要求してはいけない。** スキーマのフィールドで step-by-step の推論を要求すると `reasoning_extraction` カテゴリの **refusal** を引き起こしうる。公式は「短い説明（short explanation）を求めるにとどめる」と指示している
  - 思考 OFF / `low` effort では推論っぽいテキストが可視テキストに混ざりやすい。公式の対処は「アダプティブ思考 + `medium` effort に切り替える」
- **Implications**:
  - `note` は 1 行の短い説明にとどめ、推論の過程を書かせない
  - **プロンプトだけに頼らず、スキーマで「分からない」の置き場所を作る**ことが要点である

### タイムアウト

- **Sources Consulted**: [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration), `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
- **Findings**:

  | プラン | 既定 | 最大 |
  |---|---|---|
  | **Hobby** | **300s** | **300s** |
  | Pro | 300s | 800s |

  - **無料プランで 300 秒使える。** 以前知られていた 10 秒 / 60 秒はもう当てはまらない
  - Server Action は専用の上限を持たず、**それが属するページの `maxDuration`** に従う。Next.js 公式: "If using Server Actions, set the `maxDuration` at the **page level**"
- **Implications**:
  - **Vercel に切られる心配は実質ない。** 300 秒に対して Haiku 5.5 の 1 リクエストは桁違いに短い
  - 本当のリスクは「ハングしたリクエストを利用者が待たされる」こと。**`fetch` に `signal: AbortSignal.timeout(...)` を付ける**。abort も `fetch` が throw するので既存の try/catch に乗る
  - ストリーミングは不要（出力が数百トークンで、JSON を全部揃えてからパースする）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| SDK を入れる | `@anthropic-ai/sdk` を `dependencies` に追加 | 型が付く。エラーがクラスで分類される | **先行する 2 つの spec が定めた「実行時依存は追加しない」を破る。** バンドルが増える | 採らない |
| **採用**: `fetch` + 純粋関数 | `src/lib/estimate.ts` が `fetch` で呼び、プロンプトの組み立てと応答の検証を分ける | `vault.ts` と同じ構造。依存が増えない。検証を単体テストできる | 型を自分で書く | `vault.ts` の実績に揃える |
| プロンプトで JSON を要求 | 構造化出力を使わず `JSON.parse` | 実装が短い | **スキーマ適合の保証がない。** 前置き文やフェンスが混ざる | 採らない |
| Tool use + `strict: true` | 関数呼び出しの形で JSON を得る | 保証は構造化出力と同等 | 用途が違う。`tool_choice` の強制が使えないモデルもある | 採らない |

## Design Decisions

### Decision: 推定を純粋な検証と HTTP の呼び出しに分ける

- **Context**: 推定の結果は「スキーマに合っているか」とは別に「件数が合っているか」「非負か」をアプリ側で確かめる必要がある（スキーマで縛れない）
- **Selected Approach**: `src/lib/estimate.ts` に HTTP の呼び出しを置き、応答の検証（件数・非負・null の扱い）を**引数を取る純粋関数**として分ける
- **Rationale**: 検証の部分が単体テストで確かめられる。`vault.ts` が検証を持たないのに対し、推定は検証が本体になるため分ける価値が大きい
- **Trade-offs**: ファイルが 1 つ増える
- **Follow-up**: 外部 API を呼ぶ部分は実測で担保する（`vault.ts` と同じ）

### Decision: 「分からない」をスキーマで合法にする

- **Context**: 黙って嘘の値を返されるのが最悪の失敗である
- **Selected Approach**: `kcal` / `protein` を `anyOf: [number, null]` にし、`note` を必須にする
- **Rationale**: 構造化出力は文法制約なので、`null` を合法にしておけば**モデルが数値を出すしかない状況を作らずに済む**。プロンプトだけの指示より強い
- **Trade-offs**: `null` が返ったときの画面の分岐が必要になる（受入基準 5.1 / 5.2 で既に求めている）
- **Follow-up**: 「肉」のような曖昧な名前で実際に `null` が返るかは**実測が必要**

## Risks & Mitigations

- **曖昧な食材名で黙って平均値を返す可能性** — 「分からせる」仕組みは用意できるが、Haiku 5.5 が実際に素直に `null` を返すかは**ドキュメントからは判断できない**。**これが本 spec でいちばん重要な未検証事項である**。実測で確かめる
- **日本語の食材名での精度が不明** — 公式に日本食品標準成分表との一致度に関する情報はない。代表的な食材を成分表の値と比べて誤差を測る
- **`content[0]` を読む実装を書いてしまう** — 思考ブロックが先頭に入るため空文字になる。`find` で型を絞る。テストで押さえる
- **拒否（HTTP 200）を成功として扱ってしまう** — `stop_reason` を見ないと `content` が空のまま進む。テストで押さえる
- **推定の品質が落ちても気づけない** — AI の出力は毎回変わるため自動テストにできない。利用者が値を見て気づくことになる。これは受け入れた制約である
- **API キーの期限切れ** — 401 として扱い、何をすればよいか分かるようにする

## References

- [Messages API](https://platform.claude.com/docs/en/api/messages) — エンドポイント、必須ヘッダ、ボディとレスポンスの構造
- [Versioning](https://platform.claude.com/docs/en/api/versioning) — `anthropic-version` に `2023-06-01` を送る
- [Errors](https://platform.claude.com/docs/en/api/errors) — ステータスコードと `error.type` の対応
- [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — `output_config.format`、文法制約、スキーマのサブセット
- [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use) — 構造化出力との住み分け
- [Models overview](https://platform.claude.com/docs/en/models/overview) — モデル ID と相対レイテンシ
- [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview) — アダプティブ思考、`temperature` を送れない制約
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — 価格と 10 万トークンの境界
- [Prompting Claude Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5) — effort の選び方、思考 OFF の副作用
- [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations) — 「分からない」と言わせる許可
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration) — Hobby は 300 秒
- `node_modules/next/dist/docs/.../maxDuration.md` — Server Action はページの `maxDuration` に従う

## 実測が必要な前提（タスク 1.1 / 1.2 で潰す）

`meal-record` で GitHub API の応答を実測して「重複は 422（409 ではない）」を確定させたのと同じ工程である。
**API キーが環境に無いため設計の段階で実施できなかった。** タスク 1.1 と 1.2 で行う。
**1.1 の結果によって design が変わりうる。**

| 確かめること | なぜ必要か |
|---|---|
| **「肉」「野菜」のような曖昧な名前で `null` が返るか** | 黙って平均値を返されるのが最悪の失敗。プロンプトとスキーマの仕掛けが実際に効くかは実測しないと分からない |
| 食材 4 件の推定にかかる実時間 | 公式は相対順位（Fastest / Fast）しか公開していない。待ち時間の設計に必要 |
| 代表的な食材 10 件の誤差 | 日本食品標準成分表の値と比べ、幅（±20% 程度）に入るか |
| `effort: "low"` + 思考 OFF と既定（`medium`）の比較 | 速度と精度のどちらを採るかの判断材料 |
| `stop_reason` が `end_turn` 以外になる条件 | 拒否と `max_tokens` の扱いを決めるため |

**必要なもの**: `ANTHROPIC_API_KEY`（`.env.local` に置く）
