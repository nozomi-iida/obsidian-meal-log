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
同期している。`Meals/items/` が食事ログの保存先、`Meals/食事管理.base` が一覧ビュー。
`Meals/presets.md` は**まだ空**で、定番メニューのデータは存在しない。

vault への書き込みに使う GitHub のアクセストークンは発行済み。

### 何が変わるべきか

スマホのホーム画面からアプリを開き、食べた食材と量を入力して送信すると、
vault の `Meals/items/YYYY-MM-DD-HHmm.md` に Markdown が 1 つ置かれる状態にする。

- 食材は**毎回入力する**。名前と 100g あたりのカロリー・タンパク質、食べた量を打ち込む
- カロリーとタンパク質は入力した 100g あたりの値と量から算出する。利用者が掛け算しない
- frontmatter は 8 項目（`date` / `time` / `meal` / `menu` / `kcal` / `protein` / `foods` / `dish`）
- 本文には食材ごとの kcal 内訳を書き、後から人が数値を直せるようにする
- **書き込みは常に新規作成**。既存を読んでマージする処理は持たない
- **集計はしない**。日次・月次の合計は Obsidian の Bases と Dataview が担う
- アクセストークンはサーバー側の環境変数に置き、クライアントに渡さない

この spec の完了時点で、外出先から食事を記録し、Obsidian で日次・月次の振り返りができる状態になる。

### 本 spec の範囲

**記録に絞る。** 食材のデータを貯める仕組みを持たない。

- **プリセットという概念を持たない。** 毎回入力する。アプリは食材のデータを保持しない
- **栄養価の推定もしない。** 100g あたりの値は利用者が調べて入力する
- 食材名の表記は利用者が入力したものをそのまま使う。正規化しない

初期リリースの入力は手間がかかる。それは承知のうえで、**まず記録して vault に届く経路を
通すこと**を優先する。使ってみて初めて、何を自動化すべきかが具体的に分かる。

### 後続の spec に送るもの

- **栄養価の AI 推定** — 食材名から 100g あたりのカロリー・タンパク質を自動で出す。
  本 spec の「毎回 3 項目を打つ」手間を解消する。これが入ると入力は食材名と量の 2 つになる。
  手入力版を一度使ったうえで、食材名だけで足りるのか・調理法も要るのか・候補を複数出すべきかを
  見極めてから設計する
- **プリセット** — よく食べるものを貯めて選べるようにする。何を貯めるべきかは
  手入力の記録が溜まってから決める
- **献立単位の記録** — 「鍋」のように複数の食材をまとめた単位
- **写真からの推定** — `product.md` のスコープ外に記載済み

## Introduction

外出先のスマホから食事を記録し、vault に Markdown ファイルを 1 つ置く機能を提供する。

利用者は食材の名前と 100g あたりの概算値、食べた量を入力する。カロリーとタンパク質は
その値と量から算出する。記録は常に新規ファイルの作成であり、既存ファイルの読み取りや
内容の統合を行わない。

合計値の算出やサマリーの更新はアプリの責務ではない。正しい形のファイルを置けば、
日次・月次の集計は Obsidian 側が担う。

**アプリはデータを貯めない。** 食材のデータもプリセットも持たず、記録のたびに入力を受ける。
貯める仕組みは後続の spec で扱う。

## Boundary Context

- **In scope**: 食材の入力、量とカロリー・タンパク質の算出、食べた時刻と食事区分の決定、
  vault への新規ファイル作成、送信結果の提示
- **Out of scope**: プリセットの保持・登録・選択、栄養価の推定、食材名の正規化、
  献立単位の記録、集計とサマリーの更新、写真からの推定、オフラインでの記録、
  既存ファイルの更新、記録した内容の一覧表示と検索
- **Adjacent expectations**:
  - vault は obsidian-git によって PC・スマホと同期される。同期はアプリの責務ではなく、
    記録の完了は**vault への書き込みが終わった時点**で判断する
  - 日次・月次の集計は Obsidian の Bases と Dataview が担う。アプリは集計結果を持たない
  - 公開 URL の保護は `app-foundation` の遮断点が担う。本 spec は認証方式を定義しない
  - `Meals/presets.md` は読まない。読み取り経路そのものを作らない

## Requirements

### Requirement 1: 食材の入力

**Objective:** As a 利用者, I want 食べた食材とその量を入力したい,
so that 何をどれだけ食べたかを記録に残せる

#### Acceptance Criteria

1. When 記録画面を開いたとき, the Meal Log アプリ shall 食材の名前・100g あたりのカロリー・
   100g あたりのタンパク質・食べた量を入力する手段を示す
2. When 入力した食材を加えたとき, the Meal Log アプリ shall その食材を記録の対象に加える
3. The Meal Log アプリ shall 1 回の記録に複数の食材を含められる
4. When 記録の対象に加えた食材を取り消したとき, the Meal Log アプリ shall その食材を対象から外す
5. If 食材名が空のまま加えられようとしたとき, then the Meal Log アプリ shall 対象に加えず、
   名前が必要であることを示す
6. While 記録の対象が 1 件も無いとき, the Meal Log アプリ shall 送信を受け付けない

### Requirement 2: カロリーとタンパク質の算出

**Objective:** As a 利用者, I want 100g あたりの値と量から栄養価を自動で出してほしい,
so that 掛け算を自分でしなくて済む

#### Acceptance Criteria

1. When 食材の量または 100g あたりの値を変更したとき, the Meal Log アプリ shall その食材の
   カロリーとタンパク質を変更後の値に応じて算出し直す
2. While 記録の対象に食材があるとき, the Meal Log アプリ shall 対象すべての合計カロリーと
   合計タンパク質を示す
3. The Meal Log アプリ shall 食材ごとのカロリーとタンパク質を整数に丸めて扱う
4. The Meal Log アプリ shall 合計を、丸めた食材ごとの値の和として算出する
5. The Meal Log アプリ shall カロリーとタンパク質を単位を伴わない数値として扱う
6. If 量または 100g あたりの値に数値として解釈できない値が入力されたとき, then the Meal Log
   アプリ shall 送信を受け付けず、入力が不正であることを示す

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

### Requirement 4: vault への記録

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

### Requirement 5: 送信結果の提示

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

### Requirement 6: 書き込みに使う資格情報の扱い

**Objective:** As a 利用者, I want vault への書き込み権限が第三者に渡らない状態にしたい,
so that 公開したアプリから vault を書き換えられないようにする

#### Acceptance Criteria

1. The Meal Log アプリ shall vault への書き込みに使う資格情報をソースコードおよび
   リポジトリに含めない
2. The Meal Log アプリ shall vault への書き込みに使う資格情報を利用者の端末に渡さない
3. If 資格情報が設定されていないとき, then the Meal Log アプリ shall 記録を試みず、
   設定が不足していることを示す
