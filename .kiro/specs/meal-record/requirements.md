# Requirements Document

## Project Description (Input)

### 誰が問題を抱えているか

利用者本人ひとり。このアプリの開発者でもある。体重 82kg、タンパク質の目標は 131〜180g/日。
厳密な栄養管理が目的ではなく、月末に「タンパク質が足りていたか」を数字で振り返れることが目的。

### 現状

食事の記録は `.claude/commands/meal.md` 経由で Claude Code に頼んでいる。
PC の前にいるときは成り立つが、**外出先のスマホからは使えない**。

`app-foundation` で土台は整った。静的解析・自動テスト・Basic 認証・ホーム画面への追加が
揃っており、スマホのホーム画面から全画面で起動できる。ただし**記録そのものの機能はまだ無く**、
アプリを開いても `create-next-app` の雛形ページが出るだけ。

vault（`nozomi-iida/obsidian-vault`、private）は GitHub にあり、obsidian-git で PC・スマホと
同期している。ただし**vault 側の資産は揃っていない**。

| パス | 実際の状態 |
|---|---|
| `Meals/items/` | 食事ログの保存先 |
| `Meals/presets.md` | **まだ空。定番メニューと食材の概算値は存在しない** |
| `Meals/食事管理.base` | 横断的な一覧・絞り込みビュー |

vault への書き込みに使う GitHub のアクセストークンも**未発行**。

### 何が変わるべきか

スマホのホーム画面からアプリを開き、プリセットを選んで量を調整して送信すると、
vault の `Meals/items/YYYY-MM-DD-HHmm.md` に Markdown が 1 つ置かれる状態にする。

- プリセットにある食材は**選択式**にする。食材名の表記ゆれ（「鶏もも」「鶏もも肉」）を防ぐため。
  プリセットに無いものは手で入力できるようにする
- カロリーとタンパク質は**食材ごとに整数へ丸め**、合計はその和とする。本文に並べた数字を
  足せば frontmatter の合計になるため、後から手で直したときに検算できる
- frontmatter は 8 項目（`date` / `time` / `meal` / `menu` / `kcal` / `protein` / `foods` / `dish`）
- 本文には食材ごとの kcal 内訳を書き、後から人が数値を直せるようにする
- **書き込みは常に新規作成**。既存を読んでマージする処理は持たない
- **集計はしない**。日次・月次の合計は Obsidian の Bases と Dataview が担う
- アクセストークンはサーバー側の環境変数に置き、クライアントに渡さない

この spec の完了時点で、外出先から食事を記録し、Obsidian で日次・月次の振り返りができる状態になる。

### 本 spec の範囲

**記録に絞る。** プリセットをブラウザから登録する機能は含めない。

- プリセットのデータは**アプリ側が正本**とする。`presets.md` を読まない
- 本 spec ではプリセットを**ソースコードに数件持つ**。増やすにはデプロイが必要な状態で構わない
- 食材名の表記は**アプリ側が決める**。`presets.md` が空であるため、揃える先が無い

### 後続の spec に送るもの

- **プリセットの登録機能** — ブラウザから定番メニューを追加・編集できるようにする。
  使いながらプリセットの形を見極めたうえで設計する
- **プリセットの保存先** — vault の `presets.md` か、アプリ側のデータストアか。登録機能の
  spec で決める
- **献立単位のプリセット** — 「鍋」のように複数の食材をまとめた単位。本 spec は食材単位のみ
- **写真からの推定** — `product.md` のスコープ外に記載済み

## Introduction

外出先のスマホから食事を記録し、vault に Markdown ファイルを 1 つ置く機能を提供する。

利用者は食材を選び、食べた量をグラムで指定して送信する。カロリーとタンパク質は
食材ごとの概算値から自動で算出する。記録は常に新規ファイルの作成であり、
既存ファイルの読み取りや内容の統合を行わない。

合計値の算出やサマリーの更新はアプリの責務ではない。正しい形のファイルを置けば、
日次・月次の集計は Obsidian 側が担う。

## Boundary Context

- **In scope**: 食材の選択、未登録食材の手入力、量の調整とカロリー・タンパク質の算出、
  食べた時刻と食事区分の決定、vault への新規ファイル作成、送信結果の提示
- **Out of scope**: プリセットの登録・編集、献立単位のプリセット、集計とサマリーの更新、
  写真からの推定、オフラインでの記録、既存ファイルの更新、記録した内容の一覧表示と検索
- **Adjacent expectations**:
  - vault は obsidian-git によって PC・スマホと同期される。同期はアプリの責務ではなく、
    記録の完了は**vault への書き込みが終わった時点**で判断する
  - 日次・月次の集計は Obsidian の Bases と Dataview が担う。アプリは集計結果を持たない
  - 公開 URL の保護は `app-foundation` の遮断点が担う。本 spec は認証を実装しない
  - `Meals/presets.md` は読まない。vault 側の内容と二重になることを受け入れる

## Requirements

### Requirement 1: 食材の選択

**Objective:** As a 利用者, I want 定番の食材を一覧から選びたい,
so that 食材名を毎回打たずに記録を始められる

#### Acceptance Criteria

1. When 記録画面を開いたとき, the Meal Log アプリ shall 登録済みの食材を一覧で示す
2. When 一覧から食材を選んだとき, the Meal Log アプリ shall その食材を記録の対象に加える
3. The Meal Log アプリ shall 1 回の記録に複数の食材を含められる
4. When 記録の対象に加えた食材を取り消したとき, the Meal Log アプリ shall その食材を対象から外す
5. While 記録の対象が 1 件も無いとき, the Meal Log アプリ shall 送信を受け付けない

### Requirement 2: 量の調整とカロリー・タンパク質の算出

**Objective:** As a 利用者, I want 食べた量をグラムで指定したい,
so that 概算のカロリーとタンパク質が自動で出て、自分で計算しなくて済む

#### Acceptance Criteria

1. The Meal Log アプリ shall 食材ごとに 100g あたりのカロリーとタンパク質を保持する
2. When 食材を記録の対象に加えたとき, the Meal Log アプリ shall その食材の既定の量を示す
3. When 食材の量を変更したとき, the Meal Log アプリ shall その食材のカロリーとタンパク質を
   変更後の量に応じて算出し直す
4. While 記録の対象に食材があるとき, the Meal Log アプリ shall 対象すべての合計カロリーと
   合計タンパク質を示す
5. The Meal Log アプリ shall 食材ごとのカロリーとタンパク質を整数に丸めて扱う
6. The Meal Log アプリ shall 合計を、丸めた食材ごとの値の和として算出する
7. The Meal Log アプリ shall カロリーとタンパク質を単位を伴わない数値として扱う
8. If 量に数値として解釈できない値が入力されたとき, then the Meal Log アプリ shall
   送信を受け付けず、量の指定が不正であることを示す

### Requirement 3: 食べた時刻と食事区分

**Objective:** As a 利用者, I want 普段はそのまま送信し、後から記録するときだけ時刻を直したい,
so that その場での記録は手数を増やさず、まとめて記録する場合も正しい時刻で残せる

#### Acceptance Criteria

1. When 記録画面を開いたとき, the Meal Log アプリ shall 現在の時刻を食べた時刻の既定値として示す
2. When 食べた時刻が決まったとき, the Meal Log アプリ shall その時刻から食事区分
   （朝 / 昼 / 夜 / 間食 / 寝る前）を推定して示す
3. When 利用者が食べた時刻を変更したとき, the Meal Log アプリ shall 推定による食事区分を
   変更後の時刻に合わせて示し直す
4. When 利用者が食事区分を自ら選んだとき, the Meal Log アプリ shall 以降その指定を保持し、
   時刻の変更によって上書きしない
5. The Meal Log アプリ shall 食べた時刻を分の単位まで扱う

### Requirement 4: 未登録の食材の手入力

**Objective:** As a 利用者, I want プリセットに無いものを食べたときもその場で記録したい,
so that 外食などで記録できない食事が出ないようにする

#### Acceptance Criteria

1. Where プリセットに無い食材を記録するとき, the Meal Log アプリ shall 食材名と
   100g あたりのカロリー・タンパク質を利用者が入力できるようにする
2. When 手で入力した食材を記録の対象に加えたとき, the Meal Log アプリ shall 登録済みの食材と
   同じく量の調整と算出の対象にする
3. The Meal Log アプリ shall 手で入力した食材をプリセットとして保存しない
4. If 食材名が空のまま加えられようとしたとき, then the Meal Log アプリ shall 対象に加えず、
   名前が必要であることを示す

### Requirement 5: vault への記録

**Objective:** As a 利用者, I want 送信するだけで vault に正しい形のファイルが置かれてほしい,
so that Obsidian 側の集計がそのまま成り立つ

#### Acceptance Criteria

1. When 送信したとき, the Meal Log アプリ shall vault の食事ログの保存先に
   Markdown ファイルを 1 つ新規に作成する
2. The Meal Log アプリ shall ファイル名を食べた時刻から `YYYY-MM-DD-HHmm` の形式で決める
3. The Meal Log アプリ shall frontmatter に日付・時刻・食事区分・量つきのサマリー・
   カロリー・タンパク質・食材名のリスト・料理名を含める
4. The Meal Log アプリ shall 量つきのサマリーを食材名と量から組み立てる
5. The Meal Log アプリ shall 食材名のリストを量を含まない形で並べる
6. The Meal Log アプリ shall 本文に食材ごとのカロリーとタンパク質の内訳を含める
7. The Meal Log アプリ shall 料理名の入力を任意とする
8. If 同じ名前のファイルが保存先に既に存在するとき, then the Meal Log アプリ shall 記録せず、
   その時刻の記録が既にあることを示す
9. The Meal Log アプリ shall 既存ファイルの読み取りと内容の統合を行わない

### Requirement 6: 送信結果の提示

**Objective:** As a 利用者, I want 記録できたかどうかをその場で知りたい,
so that 失敗に気づかないまま記録が抜けることを防げる

#### Acceptance Criteria

1. While 送信中のとき, the Meal Log アプリ shall 送信中であることを示し、
   重ねての送信を受け付けない
2. When 記録が成功したとき, the Meal Log アプリ shall 成功したことと作成したファイルの名前を示す
3. If 記録が失敗したとき, then the Meal Log アプリ shall 失敗したことと、
   原因が重複・権限・通信のいずれであるかを示す
4. If 記録が失敗したとき, then the Meal Log アプリ shall 入力した内容を保持し、
   やり直せる状態にする

### Requirement 7: 書き込みに使う資格情報の扱い

**Objective:** As a 利用者, I want vault への書き込み権限が第三者に渡らない状態にしたい,
so that 公開したアプリから vault を書き換えられないようにする

#### Acceptance Criteria

1. The Meal Log アプリ shall vault への書き込みに使う資格情報をソースコードおよび
   リポジトリに含めない
2. The Meal Log アプリ shall vault への書き込みに使う資格情報を利用者の端末に渡さない
3. If 資格情報が設定されていないとき, then the Meal Log アプリ shall 記録を試みず、
   設定が不足していることを示す
