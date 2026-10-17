"use client";

import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { estimateMealKind } from "@/lib/meal-time";
import { calculateItem, sumNutrition } from "@/lib/nutrition";
import type { MealItem, MealKind } from "@/lib/types";
import {
  type EstimateState,
  estimateFoods,
  type RecordState,
  recordMeal,
} from "./actions";

/**
 * 下書き行の入力値。利用者が入力するのは食材名と量の 2 つだけである。
 *
 * 100g あたりの値は入力を求めない（受入基準 1.2）。利用者が自分で調べる手間を
 * なくすことがこの機能の目的であり、欄を残すと調べる余地を残してしまう。
 *
 * 数値の欄も文字列のまま持つ。入力途中は数値として読めない状態を通るため、
 * 数値へ変換するのは記録の対象に加えるときだけにする。
 */
type Draft = {
  readonly name: string;
  readonly grams: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  grams: "",
};

/**
 * 100g あたりの値の入力欄。推定した値が入り、利用者が直せる。
 *
 * 数値の欄も文字列のまま持つ。入力途中は数値として読めない状態を通るため、
 * 数値へ変換するのは栄養価を算出するときだけにする。
 */
type Per100gInput = {
  readonly kcal: string;
  readonly protein: string;
};

const EMPTY_PER100G: Per100gInput = {
  kcal: "",
  protein: "",
};

/**
 * 記録の対象に加えた食材 1 件。一覧の key に使う識別子を添える。
 *
 * `per100g` の欄が空のあいだは 100g あたりの値を持たない。加えた直後は必ず
 * この状態になる。値が無い食材があるうちは記録を受け付けない（受入基準 4.5）。
 *
 * `edited` は利用者が自ら値を決めたことの印である。`meal-record` の
 * `kindChosen`（利用者が食事区分を選んだか）と同じ役割を持つ。立っている食材は
 * 推定の対象に入らず、推定の結果でも上書きしない（受入基準 3.4）。
 */
type Entry = {
  readonly id: number;
  readonly name: string;
  readonly grams: number;
  readonly per100g: Per100gInput;
  readonly edited: boolean;
  /** 100g あたりの値が決まらなかった理由。利用者に示す。 */
  readonly note: string | null;
};

/**
 * 一覧に出す 1 行。食材と、量に合わせて算出した栄養価を持つ。
 *
 * 100g あたりの値を数値として読めない食材の `item` は null になる。欄が
 * 空のときと、入力が数値として読めないときの両方を含む。
 */
type Row = {
  readonly entry: Entry;
  readonly item: MealItem | null;
};

/**
 * 直前に始めた操作。記録と推定のどちらの結果を示すかを決めるために持つ。
 *
 * 結果を出す領域は 1 つで、`useActionState` の結果は次の操作が終わるまで残る。
 * これだけでは、記録に成功したあとに推定が失敗したとき「記録しました。…」が
 * 残り、失敗が成功のように見える。新しい操作を始めた時点で示す対象を
 * そちらへ移すと、見えている結果が常に最後に押したボタンのものになる。
 */
type Operation = "record" | "estimate";

/** 下書きを読んだ結果。不正なときは利用者に示す文面を持つ。 */
type DraftResult =
  | { readonly ok: true; readonly entry: Omit<Entry, "id"> }
  | { readonly ok: false; readonly message: string };

/**
 * 選べる食事区分。
 *
 * 型は実行時に残らないため、選択肢を並べるには値の側にも一覧が必要になる。
 */
const MEAL_KINDS: readonly MealKind[] = ["朝", "昼", "夜", "間食", "寝る前"];

/**
 * 初期描画で示す食事区分。
 *
 * 現在の時刻はブラウザで描画した直後に決めるため、この値が利用者の目に入るのは
 * 推定し直すまでの一瞬だけである。
 */
const INITIAL_KIND: MealKind = "朝";

/** 指で押せる大きさ（44px 以上）と、iOS で焦点時に拡大されない文字サイズを揃える。 */
const FIELD_CLASS =
  "min-h-11 rounded border border-foreground/30 bg-transparent px-3 text-base";

const BUTTON_CLASS =
  "min-h-11 rounded border border-foreground/30 px-4 text-base";

/** 送信の失敗の分類。送信の受付が返す分類をそのまま使う。 */
type ErrorReason = Extract<RecordState, { status: "error" }>["reason"];

/**
 * 失敗の分類ごとに示す文面。利用者が次に何をすればよいかが分かる粒度で書く。
 *
 * 設定エラーで必要な変数名を画面側が静的な文面として持つのは、送信の受付の
 * 戻り値に資格情報へ関わる情報を載せないためである（受入基準 6.3）。
 */
const ERROR_MESSAGES: Record<ErrorReason, string> = {
  duplicate:
    "その時刻の記録は既にあります。食べた時刻を変えてから送信してください。",
  permission:
    "vault への書き込みを拒否されました。アクセストークンの期限が切れていないか確認してください。",
  network:
    "vault に届きませんでした。入力は残してあるので、時間を置いてもう一度送信してください。",
  config:
    "書き込みの設定が足りていません。VAULT_OWNER / VAULT_REPO / VAULT_TOKEN を設定してください。",
  invalid: "入力が不正です。食材・食べた時刻・食事区分を確かめてください。",
  unauthorized:
    "認証を通らなかったため記録していません。遮断点の適用範囲が壊れている可能性があります。",
};

/** 推定の失敗の分類。推定の受付が返す分類をそのまま使う。 */
type EstimateErrorReason = Extract<
  EstimateState,
  { status: "error" }
>["reason"];

/**
 * 推定の失敗の分類ごとに示す文面。
 *
 * 分類ごとに対処が違う（受入基準 5.6）。通信なら時間を置けば直るが、資格情報が
 * 原因なら利用者が何度やり直しても直らない。ひとまとめにすると、再送で済む
 * 失敗で手入力に走ったり、直らない失敗を繰り返し試したりすることになる。
 *
 * 設定の不足で必要な変数名を画面側が静的な文面として持つのは、推定の受付の
 * 戻り値に資格情報へ関わる情報を載せないためである（受入基準 6.3）。
 */
const ESTIMATE_ERROR_MESSAGES: Record<EstimateErrorReason, string> = {
  network:
    "推定に届きませんでした。入力は残してあるので、時間を置いてもう一度「推定する」を押してください。",
  credential:
    "推定の資格情報が受け付けられませんでした。やり直しても直らないため、開発者に伝えてください。",
  malformed:
    "推定の応答が期待した形ではありませんでした。もう一度「推定する」を押してください。",
  config: "推定の設定が足りていません。ANTHROPIC_API_KEY を設定してください。",
  invalid: "推定を求めた内容が不正です。食材名を確かめてください。",
  unauthorized:
    "認証を通らなかったため推定していません。遮断点の適用範囲が壊れている可能性があります。",
};

/**
 * 入力された文字列を数値として読む。読めなければ、または負なら null。
 *
 * 空文字を先に弾く。`Number("")` は 0 になるため、素のまま変換すると
 * 未入力の欄が 0 として記録の対象に入ってしまう。
 *
 * 負の値も弾く。栄養価の算出は 0 以上の値を前提にしており、量や 100g あたりの
 * 値が負だと負のカロリーになる。`min="0"` と二重になるが、入力欄の属性は
 * ブラウザの検証を回避した送信を止められない。
 */
function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 入力欄の 2 つの値を 100g あたりの値として読む。片方でも読めなければ null。
 *
 * 片方だけで栄養価を出さない。カロリーだけで算出すると、タンパク質が 0 の
 * 記録が「値が揃っている」ように見える。
 */
function readPer100g(
  input: Per100gInput,
): { readonly kcal: number; readonly protein: number } | null {
  const kcal = parseNumber(input.kcal);
  const protein = parseNumber(input.protein);
  if (kcal === null || protein === null) {
    return null;
  }
  return { kcal, protein };
}

/** 100g あたりの欄に入力があるか。未入力と、読めない入力を分けるために見る。 */
function hasPer100gInput(input: Per100gInput): boolean {
  return input.kcal.trim() !== "" || input.protein.trim() !== "";
}

/**
 * 推定の対象になる食材か。
 *
 * 対象は 100g あたりの値を持たず、かつ利用者が値を決めていない食材だけである。
 * すでに値を持つ食材を外すのは、推定由来の値でも再推定しないためである。
 * 利用者が決めた食材を外すのは、直した値が推定で上書きされないようにするため
 * である（受入基準 3.4）。**条件分岐で上書きを防ぐのではなく、対象に入れない。**
 */
function needsEstimate(entry: Entry): boolean {
  return readPer100g(entry.per100g) === null && !entry.edited;
}

/**
 * 下書きを確定した食材として読む。1 項目でも不正なら理由を返す。
 *
 * 送信の受付（`actions.ts`）と同じ条件で弾く。検証が二重になるが、
 * 画面側で弾くほうが利用者に早く伝わる。
 *
 * 読めた食材は 100g あたりの値を持たない状態で返す。値は推定か手入力で埋まる。
 */
function readDraft(draft: Draft): DraftResult {
  const name = draft.name.trim();
  if (name === "") {
    return { ok: false, message: "食材名を入力してください。" };
  }
  const grams = parseNumber(draft.grams);
  if (grams === null) {
    return {
      ok: false,
      message: "食べた量は 0 以上の数値で入力してください。",
    };
  }
  return {
    ok: true,
    entry: { name, grams, per100g: EMPTY_PER100G, edited: false, note: null },
  };
}

/**
 * `<input type="datetime-local">` の値（`YYYY-MM-DDTHH:mm`）に整える。
 *
 * ローカルタイムの年月日時分から組み立てる。`toISOString()` は UTC に変換するため
 * 使えない。秒もタイムゾーンも付けないのは、送信の受付がこの形式だけを受けるためである。
 */
function formatLocalDateTime(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return `${date}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * 選択された値を食事区分として読む。一覧に無い値は null。
 *
 * 選択肢は `MEAL_KINDS` から並べるため実際には必ず一致するが、
 * `select` が返すのは文字列であり、型を絞るには値の照合が必要になる。
 */
function readKind(value: string): MealKind | null {
  return MEAL_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * 送信の結果を利用者に示す文面にする。まだ送信していなければ文面を持たない。
 *
 * 成功と失敗は文言で区別する。色だけに頼ると、色覚の多様性のもとで区別がつかない。
 */
function describeResult(state: RecordState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "success":
      return `記録しました。${state.fileName} を作成しました。`;
    case "error":
      return ERROR_MESSAGES[state.reason];
  }
}

/**
 * 推定の結果を利用者に示す文面にする。まだ推定していなければ文面を持たない。
 *
 * 成功しても文面を出すのは、読み上げられる領域にも推定の終わりを伝えるため
 * である。値そのものは一覧と合計に出るが、それだけでは画面を見ない利用者に
 * 届かない。
 *
 * 推定できなかった食材があるときは件数を添える。どの食材かと理由は一覧の
 * その食材の行に出る（受入基準 5.1）。
 */
function describeEstimateResult(state: EstimateState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "success": {
      const failed = state.estimates.filter((estimate) => !estimate.ok).length;
      if (failed === 0) {
        return "推定しました。";
      }
      return `推定しました。${failed} 件は推定できませんでした。`;
    }
    case "error":
      return ESTIMATE_ERROR_MESSAGES[state.reason];
  }
}

/**
 * 食材 1 件の栄養価を示す文面。量に合わせて換算した値を出す。
 *
 * **100g あたりの値は修正の入力欄が示す**（受入基準 2.7, 3.1）。送信の項目に
 * しか持たない状態では、推定が 1 桁ずれた値を返しても換算後の数字からは
 * 見分けられない。推定の品質が落ちたことに気づく手段は利用者が値を見ること
 * だけなので、根拠になる値を欄に出し、そのまま直せるようにする。
 *
 * 値が無い食材は栄養価を出せない。空欄にせず、無いことを言葉で示す。欄に
 * 入力があるのに読めないときは、値が無いのではなく入力が不正であることを示す
 * （受入基準 3.5）。推定ができなかった食材には、モデルが返した理由（`note`）を
 * そのまま添える。どの食材かは同じ行に食材名が並ぶことで分かる（受入基準 5.1）。
 */
function describeRow(row: Row): string {
  if (row.item !== null) {
    return `この量で ${row.item.kcal} kcal / タンパク質 ${row.item.protein} g`;
  }
  if (hasPer100gInput(row.entry.per100g)) {
    return "100g あたりの値は 0 以上の数値で入力してください。";
  }
  if (row.entry.note !== null) {
    return `推定できませんでした。${row.entry.note}`;
  }
  return "100g あたりの値がありません";
}

/**
 * 記録フォーム。食材を入力して記録の対象に加え、合計を示す。
 *
 * 合計は `nutrition` の関数を通して出す。送信の受付も同じ関数を通すため、
 * 画面に出る数字と vault に書かれる数字が一致する。
 */
export function RecordForm() {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [dish, setDish] = useState("");
  const [eatenAt, setEatenAt] = useState("");
  const [kind, setKind] = useState<MealKind>(INITIAL_KIND);
  // 利用者が食事区分を自ら選んだかどうか。選ばれたあとは時刻の変更で上書きしない
  // （受入基準 3.4）。深夜 1 時の食事を「寝る前」に直したあと時刻を 0:30 に
  // 直しても、選んだ指定が残るようにする。
  const [kindChosen, setKindChosen] = useState(false);
  // 最後に始めた操作。どちらの結果を示すかを決める。まだ何も押していない
  // あいだは null で、結果の領域は空になる。
  const [operation, setOperation] = useState<Operation | null>(null);
  // 一覧の key に使う識別子。食材名は重複しうるため、加えた順の連番を振る。
  const nextId = useRef(0);
  // 推定を求めた食材の識別子を、求めた順に持つ。結果は送った順に返るため、
  // この並びと突き合わせてどの食材の結果かを決める。食材名で突き合わせると、
  // 同じ名前の食材を 2 件加えたときに取り違える。
  const estimateTargets = useRef<readonly number[]>([]);
  // 送信の結果と送信中かどうか。`pending` が送信中の表示と二重送信の防止を担う
  // （受入基準 5.1）。入力はこのフックの外の state にあるため、失敗しても
  // 結果が入れ替わるだけで破棄されない（受入基準 5.4）。
  const [submitResult, formAction, pending] = useActionState(recordMeal, {
    status: "idle",
  });
  // 推定の結果と推定中かどうか。`estimating` が推定中の表示と、重ねての推定・
  // 記録の抑止を担う（受入基準 4.1, 4.2, 4.3）。
  const [estimateResult, estimateAction, estimating] = useActionState(
    estimateFoods,
    { status: "idle" },
  );

  // 現在の時刻を食べた時刻の既定値にする（受入基準 3.1）。サーバー側で決めると
  // ホストのタイムゾーン（Vercel の既定は UTC）になるため、描画後にブラウザで決める。
  // 区分の推定もここで行う。この時点では利用者が区分を選ぶ余地がない。
  useEffect(() => {
    const now = new Date();
    setEatenAt(formatLocalDateTime(now));
    setKind(estimateMealKind(now));
  }, []);

  // 記録に成功したら入力を初期状態に戻し、次の 1 食をすぐ記録できる状態にする。
  // 戻さないと、1 食ごとに食材 3〜4 件・時刻・区分・料理名を手で消す手数が
  // 上乗せされる。結果の表示は残す（受入基準 5.2 が作成したファイル名を
  // 示すことを求めている）。失敗したときは何もしない。入力を保持して
  // やり直せる状態を保つ（受入基準 5.4）。
  useEffect(() => {
    if (submitResult.status !== "success") {
      return;
    }
    // 時刻は現在時刻に戻し、区分はその時刻から推定し直す。利用者が自ら選んだ
    // 指定も解除するのは、前の記録の指定を次の記録に持ち越さないためである。
    const now = new Date();
    setEntries([]);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    setDish("");
    setEatenAt(formatLocalDateTime(now));
    setKind(estimateMealKind(now));
    setKindChosen(false);
  }, [submitResult]);

  // 推定の結果を食材ごとの 100g あたりの値として入れる。推定を求めた順に
  // 返るため、求めたときに控えた識別子の並びと突き合わせる。
  useEffect(() => {
    if (estimateResult.status !== "success") {
      return;
    }
    const estimates = estimateResult.estimates;
    const targets = estimateTargets.current;
    setEntries((current) =>
      current.map((entry) => {
        const index = targets.indexOf(entry.id);
        const estimated = index === -1 ? undefined : estimates[index];
        if (!estimated) {
          return entry;
        }
        // 利用者が自ら値を決めた食材は上書きしない（受入基準 3.4）。対象を
        // 利用者が決めていない食材に限っているため、推定を求めてから結果が
        // 返るまでに値を直した食材だけがここに来る。
        if (entry.edited) {
          return entry;
        }
        if (!estimated.ok) {
          return { ...entry, note: estimated.note };
        }
        return {
          ...entry,
          per100g: {
            kcal: String(estimated.kcalPer100g),
            protein: String(estimated.proteinPer100g),
          },
          note: null,
        };
      }),
    );
  }, [estimateResult]);

  // 栄養価を出せるのは 100g あたりの値を持つ食材だけである。値が無い食材は
  // 0 として数えない。0 kcal の食品（水、お茶）と区別がつかなくなり、
  // 合計が「値が揃っている」ように見えてしまう。
  const rows: readonly Row[] = entries.map((entry) => {
    const per100g = readPer100g(entry.per100g);
    return {
      entry,
      item:
        per100g === null
          ? null
          : calculateItem({
              name: entry.name,
              kcalPer100g: per100g.kcal,
              proteinPer100g: per100g.protein,
              grams: entry.grams,
            }),
    };
  });
  const total = sumNutrition(
    rows.flatMap((row) => (row.item === null ? [] : [row.item])),
  );
  // 100g あたりの値を数値として読めない食材が 1 件でもあるか。記録を受け付けない
  // 条件に使う（受入基準 4.5）。欄が空の食材と、修正した値が不正な食材の両方を
  // 含む（受入基準 3.5）。
  const hasMissingValue = rows.some((row) => row.item === null);
  // 推定の対象になる食材。「推定する」を押せるかの判定と、押したときに送る
  // 食材を同じ条件から出す。食い違うと押せるのに何も起きない状態になる。
  const estimateTargetEntries = entries.filter(needsEstimate);

  /**
   * 100g あたりの値を直す（受入基準 3.1）。直した食材には `edited` を立てる。
   *
   * `edited` は利用者が自ら値を決めたことの印であり、その食材を推定の対象から
   * 外す。立てないと、食材を足して推定し直したときに直した値が推定の値に戻る
   * （受入基準 3.4）。
   */
  function changePer100g(id: number, field: keyof Per100gInput, value: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              per100g: { ...entry.per100g, [field]: value },
              edited: true,
            }
          : entry,
      ),
    );
  }

  function updateDraft(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    // 欄を直し始めた時点で、直前の指摘は用済みにする。
    setDraftError(null);
  }

  /**
   * 食べた時刻を変える。区分は時刻から推定し直す（受入基準 3.3）。
   *
   * 推定はここ（クライアント）だけで行う。`estimateMealKind` はローカルタイムを
   * 見るため、サーバーで呼ぶと UTC で判定されて区分が約 9 時間ずれる。
   */
  function changeEatenAt(value: string) {
    setEatenAt(value);
    if (kindChosen) {
      return;
    }
    // 日時を含む文字列はローカルタイムとして解釈される。欄が空のときなど
    // 日時として読めない値では推定できないため、直前の区分を残す。
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      setKind(estimateMealKind(parsed));
    }
  }

  /** 利用者が食事区分を選ぶ。以降は時刻の変更で上書きしない（受入基準 3.4）。 */
  function chooseKind(value: string) {
    const chosen = readKind(value);
    if (!chosen) {
      return;
    }
    setKind(chosen);
    setKindChosen(true);
  }

  /**
   * 送信する。受付へは `<form action={formAction}>` ではなくここから渡す。
   *
   * `action` に関数を渡すと、React は送信のあと `form.reset()` を呼ぶ。制御して
   * いない料理名の欄は空に戻り、食事区分の `select` は最初の選択肢に戻る。
   * `select` は `value` で制御しているのに戻らない。送信の結果で再描画は起きる
   * が、`value` が前回の描画と同じ値なので React は DOM に書き直さないためで
   * ある。表示と送られる値が食い違ったまま残り、失敗してやり直すと利用者が
   * 選んだ区分ではなく「朝」で記録される。失敗しても入力を破棄しないために
   * （受入基準 5.4）、リセットを伴わない経路で受付へ渡す。
   *
   * 送信中であることは `useActionState` の `pending` が引き続き担う。
   */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setOperation("record");
    startTransition(() => {
      formAction(formData);
    });
  }

  /**
   * 推定を求める。対象は 100g あたりの値を持たず、利用者が値を決めていない
   * 食材だけである（受入基準 2.2, 3.4）。
   *
   * 「推定する」を `type="submit"` にしない。送信ボタンと 2 つ並ぶと、どちらを
   * 押しても同じ `onSubmit` が起きて押されたボタンを区別できない。加えて推定に
   * 送る項目は値を持たない食材の名前だけで、フォームが持つ項目とは一致しない。
   * `FormData` をここで組めば、押されたボタンと送る内容が 1 対 1 で対応する。
   *
   * 量は送らない。推定が返すのは 100g あたりの値であり、量は画面が持つ。
   */
  function requestEstimate() {
    const targets = estimateTargetEntries;
    if (targets.length === 0) {
      return;
    }
    const formData = new FormData();
    for (const target of targets) {
      formData.append("name", target.name);
    }
    estimateTargets.current = targets.map((target) => target.id);
    setOperation("estimate");
    startTransition(() => {
      estimateAction(formData);
    });
  }

  /**
   * 進行中であることと結果を 1 行で示す。
   *
   * 推定中・送信中を結果より先に示す。待っているあいだに前回の結果が
   * 残っていると、押した操作が届いたのかが分からない。
   *
   * 結果は最後に始めた操作のものだけを示す。記録の結果を示したまま推定の
   * 失敗を無視すると「押しても何も起きない」ように見え、逆に記録の成功を
   * 残したまま推定が失敗すると失敗が成功のように見える。
   */
  function describeProgress(): string | null {
    if (estimating) {
      return "推定中です。";
    }
    if (pending) {
      return "送信中です。";
    }
    switch (operation) {
      case null:
        return null;
      case "record":
        return describeResult(submitResult);
      case "estimate":
        return describeEstimateResult(estimateResult);
    }
  }

  function addEntry() {
    const result = readDraft(draft);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    const id = nextId.current;
    nextId.current += 1;
    setEntries((current) => [...current, { id, ...result.entry }]);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
  }

  function removeEntry(id: number) {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-6 px-4 py-6">
      <h1 className="text-xl font-semibold">食事を記録する</h1>

      <fieldset className="flex flex-col gap-3">
        <legend className="pb-2 text-sm font-medium">いつ・何を食べたか</legend>
        {/*
          日時はタイムゾーン情報を持たない形で送る。`datetime-local` の値は
          `2026-10-11T19:00` のような文字列になるため、加工せずそのまま送れば
          サーバー側で日時を解釈する必要がなくなる。
        */}
        <label className="flex flex-col gap-1 text-sm" htmlFor="eaten-at">
          食べた時刻
          <input
            id="eaten-at"
            className={FIELD_CLASS}
            type="datetime-local"
            name="eatenAt"
            value={eatenAt}
            onChange={(event) => changeEatenAt(event.target.value)}
          />
        </label>
        {/*
          区分は推定結果でも利用者の指定でも、確定した値として送る。
          サーバーは推定し直さない（受入基準 3.4 の指定が消えるため）。
        */}
        <label className="flex flex-col gap-1 text-sm" htmlFor="kind">
          食事区分
          <select
            id="kind"
            className={FIELD_CLASS}
            name="kind"
            value={kind}
            onChange={(event) => chooseKind(event.target.value)}
          >
            {MEAL_KINDS.map((mealKind) => (
              <option key={mealKind} value={mealKind}>
                {mealKind}
              </option>
            ))}
          </select>
        </label>
        {/* 料理名の入力は任意（受入基準 4.7）。成功したら空に戻すため state で持つ。 */}
        <label className="flex flex-col gap-1 text-sm" htmlFor="dish">
          料理名（任意）
          <input
            id="dish"
            className={FIELD_CLASS}
            type="text"
            name="dish"
            value={dish}
            onChange={(event) => setDish(event.target.value)}
          />
        </label>
      </fieldset>

      {/*
        下書き行には送信用の項目名を付けない。付けると未入力のまま送信したときに
        4 つの繰り返し項目へ空の要素が 1 つずつ増え、確定済みの食材が正しくても
        送信全体が入力不正になる。下書きは state だけで持つ。
      */}
      <fieldset className="flex flex-col gap-3">
        <legend className="pb-2 text-sm font-medium">食材を加える</legend>
        <label className="flex flex-col gap-1 text-sm" htmlFor="draft-name">
          食材名
          <input
            id="draft-name"
            className={FIELD_CLASS}
            type="text"
            value={draft.name}
            onChange={(event) => updateDraft("name", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="draft-grams">
          食べた量（g）
          <input
            id="draft-grams"
            className={FIELD_CLASS}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.grams}
            onChange={(event) => updateDraft("grams", event.target.value)}
          />
        </label>
        <button className={BUTTON_CLASS} type="button" onClick={addEntry}>
          この食材を加える
        </button>
        {draftError === null ? null : (
          <p className="text-sm" role="alert">
            {draftError}
          </p>
        )}
      </fieldset>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">記録の対象</h2>
        {rows.length === 0 ? (
          <p className="text-sm">食材を 1 件以上加えると送信できます。</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li
                key={row.entry.id}
                className="flex flex-col items-start gap-1 border-b border-foreground/20 py-3"
              >
                {/*
                  確定した食材だけを 4 本組の項目として送る。確定した数だけ並ぶため、
                  4 つの繰り返し項目の長さは構造上必ず一致する。

                  100g あたりの 2 項目は修正の入力欄がそのまま送信の項目を兼ねる。
                  値を持たない食材でも欄は並ぶため空で送られ、長さの一致は崩れない。
                  項目を省くと長さの一致が崩れて別の食材の値が隣にずれて入り、
                  `name` ごと省くとその食材が記録から静かに抜ける。
                  空で送れば受付の `parseNumber` が null を返して送信全体が入力不正に
                  なる。値が揃わないうちは「記録する」を押せないため通常は送られない
                  が、その無効化が壊れたときに誤った記録が作られるのを受付が止める。
                */}
                <input type="hidden" name="name" value={row.entry.name} />
                <input type="hidden" name="grams" value={row.entry.grams} />
                <span className="font-medium">
                  {row.entry.name} {row.entry.grams}g
                </span>
                {/*
                  100g あたりの値は修正できる欄として出す（受入基準 3.1）。
                  推定できなかった食材にも同じ欄が並ぶため、その食材だけ手で
                  入力して記録に進める（受入基準 5.2）。

                  欄は食材ごとに並ぶため、項目名を付けた状態で値の無い食材の
                  欄も空文字として送られる。下書き行と違い、確定した食材の欄
                  なので項目名を付けてよい。
                */}
                <div className="flex w-full gap-2">
                  <label
                    className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
                    htmlFor={`kcal-per-100g-${row.entry.id}`}
                  >
                    100g あたりのカロリー
                    <input
                      id={`kcal-per-100g-${row.entry.id}`}
                      className={FIELD_CLASS}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      name="kcalPer100g"
                      value={row.entry.per100g.kcal}
                      onChange={(event) =>
                        changePer100g(row.entry.id, "kcal", event.target.value)
                      }
                    />
                  </label>
                  <label
                    className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
                    htmlFor={`protein-per-100g-${row.entry.id}`}
                  >
                    100g あたりのタンパク質
                    <input
                      id={`protein-per-100g-${row.entry.id}`}
                      className={FIELD_CLASS}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      name="proteinPer100g"
                      value={row.entry.per100g.protein}
                      onChange={(event) =>
                        changePer100g(
                          row.entry.id,
                          "protein",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </div>
                {/*
                  値が無い食材は栄養価を出せない。空欄にせず、無いことを言葉で
                  示す。推定できなかった食材には理由を添える（受入基準 5.1）。
                  修正した値が読めないときは入力が不正であることを示す
                  （受入基準 3.5）。
                */}
                <span className="text-sm">{describeRow(row)}</span>
                <button
                  className={BUTTON_CLASS}
                  type="button"
                  onClick={() => removeEntry(row.entry.id)}
                >
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        )}
        {/*
          推定の対象は 100g あたりの値を持たず、利用者が値を決めていない食材
          だけである（受入基準 2.2）。対象が 0 件のときは押せない。食材が 1 件も
          無いときも対象が 0 件になるため、この 1 つの条件に含まれる。すでに値を
          持つ食材と利用者が決めた食材を対象にしないことで、利用者が直した値が
          推定で上書きされない（受入基準 3.4）。

          推定中も押せない。重ねて押すと同じ食材の推定が二重に走る
          （受入基準 4.2）。
        */}
        <button
          className={BUTTON_CLASS}
          type="button"
          onClick={requestEstimate}
          disabled={estimating || estimateTargetEntries.length === 0}
        >
          {estimating ? "推定中…" : "推定する"}
        </button>
      </section>

      {/* 1 食で 3〜4 品入力するため、合計と送信は画面の下端に留めて常に見えるようにする。 */}
      <section className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-foreground/20 bg-background py-3">
        <h2 className="text-sm font-medium">合計</h2>
        <p className="text-2xl font-semibold">
          {total.kcal} kcal / タンパク質 {total.protein} g
        </p>
        {/*
          送信中は押せない状態にする。重ねて送ると 2 回目は同じ名前のファイルを
          作ろうとして重複になる（受入基準 5.1）。対象が 1 件も無いときも押せない
          （受入基準 1.6）。食べた時刻が空のときも押せないのは、そのまま送ると
          受付が入力不正を返すものの、その理由はどの欄が悪いかを区別しないためである。

          100g あたりの値を持たない食材があるときも押せない（受入基準 4.5）。
          その食材の 2 項目は空で送られ、受付は送信全体を入力不正として弾く。
          押せる状態にしておくと、利用者には「入力が不正です」としか見えない。
          修正した値が数値として読めない食材があるときも同じく押せない
          （受入基準 3.5）。どの食材の値が読めないかは行の文面が示す。

          推定中も押せない（受入基準 4.3）。推定の結果が返ると食材の値が
          変わるため、待っているあいだの記録は利用者が見ていない値で作られる。
        */}
        <button
          className={BUTTON_CLASS}
          type="submit"
          disabled={
            pending ||
            estimating ||
            entries.length === 0 ||
            eatenAt === "" ||
            hasMissingValue
          }
        >
          {pending ? "送信中…" : "記録する"}
        </button>
        {/*
          結果は読み上げられる領域に出す。文面が無いうちから領域を置いておくのは、
          後から現れた領域は読み上げられないことがあるためである。
        */}
        <p aria-live="polite" className="text-sm" role="status">
          {describeProgress()}
        </p>
      </section>
    </form>
  );
}
