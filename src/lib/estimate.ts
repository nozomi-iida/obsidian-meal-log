import type { FoodEstimate } from "./types";

const API_ENDPOINT = "https://api.anthropic.com/v1/messages";

/**
 * 要求に添える API のバージョン。
 *
 * 存在する値はこれと `2023-01-01`（deprecated）の 2 つだけなので、日付を
 * 上げる必要はない。API リファレンスのヘッダ表は optional と書いているが
 * versioning のページは必須と書いており、記述が食い違っているので常に送る。
 */
const API_VERSION = "2023-06-01";

/**
 * 推定に使うモデル。
 *
 * 公式が「分類・抽出のような大量かつ待たせたくない用途」に位置づけており、
 * 構造化出力にも対応する。ID に日付のサフィックスは付かない。
 */
const MODEL = "claude-haiku-5-5";

/**
 * 応答に許すトークン数の上限。
 *
 * このモデルはアダプティブ思考が既定で有効なので、思考のトークンもここから
 * 消費される。上限に当たると JSON が途中で切れて `stop_reason` が
 * `max_tokens` になり、**その回の推定が食材ごと全部失われる**。個別の失敗には
 * 落ちない。
 *
 * `max_tokens` は上限であって課金されるのは実際に生成した分だけなので、
 * 高く置いても費用は増えない。
 *
 * 実測では食材 30 件で出力 3315 / 3756 / 3437 トークン（n=3、うち思考が
 * 2036〜2504）。1 件あたり 110〜125 トークンなので、この値に当たるのは
 * 65〜74 件あたりである。1 回の食事でその件数には達しない。記録に含める
 * 食材の件数に上限は無いため、食材が増えても当たらない側に倒してある。
 */
const MAX_TOKENS = 8192;

/**
 * 1 回の推定を待つ上限。
 *
 * 配置先の関数の上限は 300 秒あるので、切られないようにするための値ではない。
 * 短く切るのはハングした要求を利用者に待たせないためである。
 *
 * 実測は食材 30 件で 15.5 / 17.2 / 15.5 秒（n=3、最大 **17.2 秒**）。
 * 食材 4 件で 2.9 秒、10 件で 4.9 秒。この値は 30 件の最大に対し
 * **3.5 倍**の余裕である。
 *
 * **件数と実時間は線形ではない。** 20 件は思考が走らず 4.3 秒だが、30 件は
 * 3 回とも走って 15〜17 秒になる。**何件でこの値に達するかは測っていない。**
 * 記録に含める食材の件数に上限が無いため、短く切ると件数の多い記録で
 * 正常な応答を打ち切る。**打ち切るとその回の推定が食材ごと全部失われる**
 * （個別の失敗には落ちない）ので、当たらない側に倒してある。
 *
 * 代償はハングした要求を最大 1 分待たせることである。1 食 3〜4 件なら
 * 実時間は 2.4 秒なので、通常の記録でこの上限を意識することはない。
 */
const TIMEOUT_MS = 60_000;

/**
 * 構造化出力のスキーマ。
 *
 * **`kcal` と `protein` を nullable にすることが「分からないと言わせる」仕掛け
 * そのものである。** 構造化出力は文法制約サンプリングなので、`null` を合法な
 * 出力にしておけばモデルが数値を出すしかない状況を作らずに済む。プロンプトだけの
 * 指示より強い。
 *
 * 数値の下限（`minimum`）と配列の件数（`minItems` は 0 か 1 のみ）はこの
 * スキーマで縛れない。そのため非負の検証と件数の突き合わせが `readEstimates`
 * に残る。
 *
 * トップレベルを配列にできるかは公式に記述がないため `items` で包む。
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kcal: { anyOf: [{ type: "number" }, { type: "null" }] },
          protein: { anyOf: [{ type: "number" }, { type: "null" }] },
          note: { type: "string" },
        },
        required: ["name", "kcal", "protein", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * 推定の指示。
 *
 * `note` には 1 行の短い説明しか求めない。スキーマのフィールドで段階的な推論を
 * 要求すると `reasoning_extraction` の分類で拒否されうると公式が明記している。
 *
 * **拠る版を指定しているのは、指定しないとモデルが古い版の値を返すためである。**
 * 版を指定しない文面では「鶏むね」が 21 回中 8 回で 191 kcal（成分表の
 * 八訂は 133 kcal）になり、108 kcal に振れる回もあった。版を指定すると
 * 25 回とも 145 kcal に収まる。
 *
 * **ただし八訂の値に揃うわけではない。** 揃うのは回ごとの振れが止まるところ
 * までで、返る値は七訂（2015 年版）相当である。白米 358（八訂 342）、
 * 納豆 200（184）、卵 151（142）、鶏むね 145（133）がいずれも七訂の収載値に
 * 一致する。**エネルギーは +4〜+9% 高めに出る**と見ておくこと。八訂は
 * エネルギーの算出方法を改めており、文面はその差を埋められていない。
 * たんぱく質は 8 件中 6 件が誤差 0% で、こちらは版の差が小さい。
 *
 * **部位や皮の有無を特定の食材名で例示しない。** 「鶏もも」を例に挙げた文面は
 * 鶏ももにだけ効き、同じ条件を持つ鶏むねには効かなかった。条件のほうを
 * 書くと両方に効く。ただし**鶏むねの外れ値を直したのはこの行ではなく版の
 * 指定である**（一般則だけの文面では 3 回中 1 回が 191 kcal に振れた）。
 */
const SYSTEM_PROMPT = `あなたは食品の栄養価を推定する。入力された食材名ごとに、
調理前（生）の状態の可食部 100g あたりのエネルギー（kcal）と
たんぱく質（g）を推定する。

- 値は調理前（生）の可食部 100g あたりとする。ゆでる・焼く・揚げるなどの
  調理による重量や成分の変化は反映しない。
- 部位・皮の有無・脂身の有無のように、名前に書かれていなくても値が大きく
  変わる条件は、その食品として最も一般に流通している状態を仮定する。
  食肉と魚は、取り除くと書かれていない限り皮と脂身を含む状態とする。
  仮定した条件を note に 1 行で書く。
- 値は日本食品標準成分表2020年版（八訂）の収載値に合わせる。八訂は
  エネルギーの算出方法を改めており、七訂までの値とは異なる。
  古い版の値を答えてはならない。
- 米など生の状態で食べない食材も、生（乾物）の状態の 100g あたりで答える。
  炊飯後の値は答えない。
- 食材名が具体的な食品を特定できないほど曖昧な場合（例: 「肉」「野菜」
  「惣菜」）、および自信を持って推定できない場合は、kcal と protein を
  null にし、note に理由を 1 行で書く。
  推測で数値を埋めてはならない。分からないことを申告するほうが
  間違った数値を返すよりはるかに望ましい。
- note は 1 行の短い説明にとどめる。推論の過程は書かない。
- 入力された食材は、順序と件数を変えずにすべて返す。`;

/** 推定できなかった理由が応答から読めないときに示す文面。 */
const UNKNOWN_NOTE = "推定できなかった";

/** 推定に使う資格情報。 */
export type EstimateConfig = {
  readonly apiKey: string;
};

/** 推定そのものが成立しなかった理由。利用者に示す 3 分類に対応する。 */
export type EstimateFailure =
  /** 通信できなかった。再送で直りうる。 */
  | "network"
  /** 資格情報が無効。利用者が再送しても直らない。 */
  | "credential"
  /** 応答が期待した形でなかった。 */
  | "malformed";

/** 推定の結果。 */
export type EstimateResult =
  | { readonly ok: true; readonly estimates: readonly FoodEstimate[] }
  | { readonly ok: false; readonly reason: EstimateFailure };

/**
 * 環境変数から推定の資格情報を読み出す。無ければ null。
 *
 * 呼び出し側は null のとき推定を試みない。キーなしで要求を組み立てると
 * 設定の不足が資格情報のエラーに化けて原因が分からなくなる。
 *
 * 引数で受け取るのは、API キーをクライアントに渡さないためと、要求ごとに
 * 読み出せるようにするためである。モジュールの読み込み時に固定すると、
 * 設定を変えたときに再起動が必要になる。
 */
export function loadEstimateConfig(
  env: Record<string, string | undefined>,
): EstimateConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return { apiKey };
}

/** 解釈していない値からプロパティを取り出す。オブジェクトでなければ undefined。 */
function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

/**
 * 栄養価として採れる値かを確かめる。
 *
 * スキーマで数値の下限を縛れないため、負の値と有限でない値はここで弾く。
 * `null` が「分からない」の申告であるのに対し、これらは応答が壊れている印である。
 */
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 応答から推定の JSON が入った text ブロックを取り出す。無ければ null。
 *
 * **`content[0]` を読んではいけない。** このモデルはアダプティブ思考が既定で
 * 有効で、先頭に text を持たない `thinking` ブロックが入りうる。型で絞り込む。
 */
function readText(payload: unknown): string | null {
  const content = readProperty(payload, "content");
  if (!Array.isArray(content)) {
    return null;
  }
  for (const block of content) {
    const text = readProperty(block, "text");
    if (readProperty(block, "type") === "text" && typeof text === "string") {
      return text;
    }
  }
  return null;
}

/**
 * 応答の本文から食材ごとの推定を組み立てる。応答が壊れていれば null。
 *
 * 入力と同じ順序・同じ件数で返す。名前はモデルが返した値ではなく入力の名前を
 * 使う。モデルが名前を言い換えても呼び出し側が食材を取り違えないためである。
 *
 * 要求を組み立てる部分から分けているのは、スキーマで縛れない検証がここに
 * 全部来るためである。この関数だけは通信なしで確かめられる。
 */
function readEstimates(
  names: readonly string[],
  text: string,
): readonly FoodEstimate[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const items = readProperty(parsed, "items");
  // 件数はスキーマで縛れないので、ここで入力と突き合わせる。
  if (!Array.isArray(items) || items.length !== names.length) {
    return null;
  }

  return names.map((name, index): FoodEstimate => {
    const item: unknown = items[index];
    const kcal = readProperty(item, "kcal");
    const protein = readProperty(item, "protein");
    if (isNonNegativeNumber(kcal) && isNonNegativeNumber(protein)) {
      return { name, ok: true, kcalPer100g: kcal, proteinPer100g: protein };
    }
    // 片方しか採れなかった場合もこの食材は推定できなかったものとして扱う。
    // 欠けた側を 0 で埋めると、0 kcal の食品と区別がつかなくなる。
    const note = readProperty(item, "note");
    return {
      name,
      ok: false,
      note: typeof note === "string" && note !== "" ? note : UNKNOWN_NOTE,
    };
  });
}

/**
 * 食材名から 100g あたりの値を推定する。例外は投げない。
 *
 * `names` は 1 件以上で、各要素は空文字でないことを前提にする。返る配列は
 * 入力と同じ順序・同じ件数である。
 *
 * **個別の失敗と全体の失敗は別である。** ある食材だけ推定できなかった場合は
 * `ok: true` のまま、その要素が `ok: false` になる。1 件の失敗で全体を失敗に
 * すると、推定できた食材の値も失われる。
 *
 * 失敗はステータスコードと `stop_reason` で分類する。応答本文の文面は見ない。
 * - 401 / 402 / 403 … キーが無効・課金の問題・権限の不足。再送では直らない
 * - 429 / 500 / 504 / 529 … 一時的。時間を置けば直りうる
 * - それ以外の 200 でない応答 … アプリが組んだ要求が不正（400 / 413 など）
 * - 通信失敗 … 到達できなかった。タイムアウトによる abort もここに来る
 * - `stop_reason` が `end_turn` 以外 … 拒否または出力の打ち切り
 *
 * 失敗しても応答の内容をログに出さない。要求のヘッダに API キーが含まれるため。
 */
export async function estimate(
  config: EstimateConfig,
  names: readonly string[],
): Promise<EstimateResult> {
  let response: Response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
        "Content-Type": "application/json",
      },
      // temperature / top_p / top_k は送らない。このモデルは既定値以外を
      // 受け取ると 400 を返す。
      //
      // thinking と effort も指定しない。既定（effort が medium でアダプティブ
      // 思考が有効）のまま使う。
      //
      // 実測では effort: "low" + 思考 OFF は食材 4 件で 0.3 秒しか速くならず、
      // その一方で鶏むねが 3 回とも 108 kcal（成分表から -18.8%）に固定され、
      // 豆腐まで null になった。0.3 秒と引き換えに精度を落とす取引になる。
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        // 食材名に区切り記号や改行が入っても境界が曖昧にならないよう JSON で渡す
        messages: [{ role: "user", content: JSON.stringify(names) }],
        output_config: {
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
      }),
      // ハングした要求を利用者に待たせない。abort も fetch の throw として届く
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // 到達できなかった場合。理由は呼び出し側に渡さない。
    return { ok: false, reason: "network" };
  }

  if (
    response.status === 401 ||
    response.status === 402 ||
    response.status === 403
  ) {
    return { ok: false, reason: "credential" };
  }
  if (
    response.status === 429 ||
    response.status === 500 ||
    response.status === 504 ||
    response.status === 529
  ) {
    return { ok: false, reason: "network" };
  }
  if (response.status !== 200) {
    return { ok: false, reason: "malformed" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // **`stop_reason` を `content` より先に見る。** 拒否は HTTP 200 で返り、
  // `max_tokens` なら JSON が途中で切れている。どちらも `content` は使えない。
  if (readProperty(payload, "stop_reason") !== "end_turn") {
    return { ok: false, reason: "malformed" };
  }

  const text = readText(payload);
  if (text === null) {
    return { ok: false, reason: "malformed" };
  }

  const estimates = readEstimates(names, text);
  if (estimates === null) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, estimates };
}
