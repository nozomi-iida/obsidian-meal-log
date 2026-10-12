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
import type { FoodInput, MealKind } from "@/lib/types";
import { type RecordState, recordMeal } from "./actions";

/**
 * 下書き行の入力値。
 *
 * 数値の欄も文字列のまま持つ。入力途中は数値として読めない状態を通るため、
 * 数値へ変換するのは記録の対象に加えるときだけにする。
 */
type Draft = {
  readonly name: string;
  readonly kcalPer100g: string;
  readonly proteinPer100g: string;
  readonly grams: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  kcalPer100g: "",
  proteinPer100g: "",
  grams: "",
};

/** 記録の対象に加えた食材。一覧の key に使う識別子を添える。 */
type Food = {
  readonly id: number;
  readonly input: FoodInput;
};

/** 下書きを読んだ結果。不正なときは利用者に示す文面を持つ。 */
type DraftResult =
  | { readonly ok: true; readonly food: FoodInput }
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
 * 下書きを確定した食材として読む。1 項目でも不正なら理由を返す。
 *
 * 送信の受付（`actions.ts`）と同じ条件で弾く。検証が二重になるが、
 * 画面側で弾くほうが利用者に早く伝わる。
 */
function readDraft(draft: Draft): DraftResult {
  const name = draft.name.trim();
  if (name === "") {
    return { ok: false, message: "食材名を入力してください。" };
  }
  const kcalPer100g = parseNumber(draft.kcalPer100g);
  const proteinPer100g = parseNumber(draft.proteinPer100g);
  const grams = parseNumber(draft.grams);
  if (kcalPer100g === null || proteinPer100g === null || grams === null) {
    return {
      ok: false,
      message: "カロリー・タンパク質・量は 0 以上の数値で入力してください。",
    };
  }
  return { ok: true, food: { name, kcalPer100g, proteinPer100g, grams } };
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
 * 記録フォーム。食材を入力して記録の対象に加え、合計を示す。
 *
 * 合計は `nutrition` の関数を通して出す。送信の受付も同じ関数を通すため、
 * 画面に出る数字と vault に書かれる数字が一致する。
 */
export function RecordForm() {
  const [foods, setFoods] = useState<readonly Food[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [dish, setDish] = useState("");
  const [eatenAt, setEatenAt] = useState("");
  const [kind, setKind] = useState<MealKind>(INITIAL_KIND);
  // 利用者が食事区分を自ら選んだかどうか。選ばれたあとは時刻の変更で上書きしない
  // （受入基準 3.4）。深夜 1 時の食事を「寝る前」に直したあと時刻を 0:30 に
  // 直しても、選んだ指定が残るようにする。
  const [kindChosen, setKindChosen] = useState(false);
  // 一覧の key に使う識別子。食材名は重複しうるため、加えた順の連番を振る。
  const nextId = useRef(0);
  // 送信の結果と送信中かどうか。`pending` が送信中の表示と二重送信の防止を担う
  // （受入基準 5.1）。入力はこのフックの外の state にあるため、失敗しても
  // 結果が入れ替わるだけで破棄されない（受入基準 5.4）。
  const [submitResult, formAction, pending] = useActionState(recordMeal, {
    status: "idle",
  });

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
    setFoods([]);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    setDish("");
    setEatenAt(formatLocalDateTime(now));
    setKind(estimateMealKind(now));
    setKindChosen(false);
  }, [submitResult]);

  const entries = foods.map((food) => ({
    id: food.id,
    input: food.input,
    item: calculateItem(food.input),
  }));
  const total = sumNutrition(entries.map((entry) => entry.item));

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
    startTransition(() => {
      formAction(formData);
    });
  }

  function addFood() {
    const result = readDraft(draft);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    const id = nextId.current;
    nextId.current += 1;
    setFoods((current) => [...current, { id, input: result.food }]);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
  }

  function removeFood(id: number) {
    setFoods((current) => current.filter((food) => food.id !== id));
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
        <label className="flex flex-col gap-1 text-sm" htmlFor="draft-kcal">
          100g あたりのカロリー
          <input
            id="draft-kcal"
            className={FIELD_CLASS}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.kcalPer100g}
            onChange={(event) => updateDraft("kcalPer100g", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="draft-protein">
          100g あたりのタンパク質
          <input
            id="draft-protein"
            className={FIELD_CLASS}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.proteinPer100g}
            onChange={(event) =>
              updateDraft("proteinPer100g", event.target.value)
            }
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
        <button className={BUTTON_CLASS} type="button" onClick={addFood}>
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
        {entries.length === 0 ? (
          <p className="text-sm">食材を 1 件以上加えると送信できます。</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col items-start gap-1 border-b border-foreground/20 py-3"
              >
                {/*
                  確定した食材だけを 4 本組の項目として送る。確定した数だけ並ぶため、
                  4 つの繰り返し項目の長さは構造上必ず一致する。
                */}
                <input type="hidden" name="name" value={entry.input.name} />
                <input
                  type="hidden"
                  name="kcalPer100g"
                  value={entry.input.kcalPer100g}
                />
                <input
                  type="hidden"
                  name="proteinPer100g"
                  value={entry.input.proteinPer100g}
                />
                <input type="hidden" name="grams" value={entry.input.grams} />
                <span className="font-medium">
                  {entry.item.name} {entry.item.grams}g
                </span>
                <span className="text-sm">
                  {entry.item.kcal} kcal / タンパク質 {entry.item.protein} g
                </span>
                <button
                  className={BUTTON_CLASS}
                  type="button"
                  onClick={() => removeFood(entry.id)}
                >
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        )}
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
        */}
        <button
          className={BUTTON_CLASS}
          type="submit"
          disabled={pending || entries.length === 0 || eatenAt === ""}
        >
          {pending ? "送信中…" : "記録する"}
        </button>
        {/*
          結果は読み上げられる領域に出す。文面が無いうちから領域を置いておくのは、
          後から現れた領域は読み上げられないことがあるためである。
        */}
        <p aria-live="polite" className="text-sm" role="status">
          {pending ? "送信中です。" : describeResult(submitResult)}
        </p>
      </section>
    </form>
  );
}
