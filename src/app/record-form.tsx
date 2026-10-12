"use client";

import { useRef, useState } from "react";
import { calculateItem, sumNutrition } from "@/lib/nutrition";
import type { FoodInput } from "@/lib/types";

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

/** 指で押せる大きさ（44px 以上）と、iOS で焦点時に拡大されない文字サイズを揃える。 */
const FIELD_CLASS =
  "min-h-11 rounded border border-foreground/30 bg-transparent px-3 text-base";

const BUTTON_CLASS =
  "min-h-11 rounded border border-foreground/30 px-4 text-base";

/**
 * 入力された文字列を数値として読む。読めなければ null。
 *
 * 空文字を先に弾く。`Number("")` は 0 になるため、素のまま変換すると
 * 未入力の欄が 0 として記録の対象に入ってしまう。
 */
function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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
      message: "カロリー・タンパク質・量は数値で入力してください。",
    };
  }
  return { ok: true, food: { name, kcalPer100g, proteinPer100g, grams } };
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
  // 一覧の key に使う識別子。食材名は重複しうるため、加えた順の連番を振る。
  const nextId = useRef(0);

  const entries = foods.map((food) => ({
    id: food.id,
    input: food.input,
    item: calculateItem(food.input),
  }));
  const total = sumNutrition(entries.map((entry) => entry.item));

  function updateDraft(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
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
    <form className="flex flex-1 flex-col gap-6 px-4 py-6">
      <h1 className="text-xl font-semibold">食事を記録する</h1>

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

      {/* 1 食で 3〜4 品入力するため、合計は画面の下端に留めて常に見えるようにする。 */}
      <section className="sticky bottom-0 mt-auto border-t border-foreground/20 bg-background py-3">
        <h2 className="text-sm font-medium">合計</h2>
        <p className="text-2xl font-semibold">
          {total.kcal} kcal / タンパク質 {total.protein} g
        </p>
      </section>
    </form>
  );
}
