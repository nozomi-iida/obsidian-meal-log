"use server";

import { headers } from "next/headers";
import { loadCredentials, verifyCredentials } from "@/lib/basic-auth";
import {
  type EstimateFailure,
  estimate,
  loadEstimateConfig,
} from "@/lib/estimate";
import { buildFileName, buildNote } from "@/lib/note";
import { calculateItem } from "@/lib/nutrition";
import type {
  FoodEstimate,
  FoodInput,
  LocalDateTime,
  MealKind,
  MealRecord,
} from "@/lib/types";
import { loadVaultConfig, writeNote } from "@/lib/vault";

/** 送信の結果。記録フォームがこれを表示に使う。 */
export type RecordState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly fileName: string }
  | {
      readonly status: "error";
      readonly reason:
        | "duplicate"
        | "permission"
        | "network"
        | "config"
        | "invalid"
        | "unauthorized";
    };

/**
 * 推定の結果。記録フォームがこれを表示に使う。
 *
 * `EstimateFailure`（`network` / `credential` / `malformed`）は推定そのものが
 * 成立しなかった理由で、`src/lib/estimate.ts` から来る。受付が足すのは
 * そこに届く前に止まった 3 つだけである。
 */
export type EstimateState =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly estimates: readonly FoodEstimate[] }
  | {
      readonly status: "error";
      readonly reason: "invalid" | "unauthorized" | "config" | EstimateFailure;
    };

/**
 * 受け付ける食事区分。
 *
 * 送信された値が `MealKind` のいずれかであることを実行時に確かめるために持つ。
 * 型は実行時には残らないため、値の側にも一覧が必要になる。
 */
const MEAL_KINDS: readonly MealKind[] = ["朝", "昼", "夜", "間食", "寝る前"];

/** `YYYY-MM-DDTHH:mm` だけを受ける。秒もタイムゾーンも付かない形に限る。 */
const EATEN_AT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

const INVALID: RecordState = { status: "error", reason: "invalid" };

const INVALID_ESTIMATE: EstimateState = { status: "error", reason: "invalid" };

/**
 * 送信された値を数値として読む。読めなければ、または負なら null。
 *
 * 空文字を先に弾く。`Number("")` は 0 になるため、素のまま変換すると
 * 未入力の欄が 0 として記録されてしまう。
 *
 * 負の値も弾く。栄養価の算出は 0 以上の値を前提にしており、量や 100g あたりの
 * 値が負だと負のカロリーが vault に書かれる。画面側でも弾くが、ブラウザの
 * 検証を回避した送信を止められるのはここだけである（多層防御）。
 */
function parseNumber(value: FormDataEntryValue | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 送信された食材を読む。1 件でも不正なら null。
 *
 * 食材ごとの 4 項目は同じ名前の繰り返しとして届く。4 つの配列の長さが
 * 揃っていることを確かめる。欠けたまま組み合わせると、別の食材の値が
 * 隣にずれて入る。
 */
function parseFoodInputs(formData: FormData): readonly FoodInput[] | null {
  const names = formData.getAll("name");
  const kcals = formData.getAll("kcalPer100g");
  const proteins = formData.getAll("proteinPer100g");
  const gramsList = formData.getAll("grams");

  if (names.length === 0) {
    return null;
  }
  if (
    kcals.length !== names.length ||
    proteins.length !== names.length ||
    gramsList.length !== names.length
  ) {
    return null;
  }

  const inputs: FoodInput[] = [];
  for (const [index, rawName] of names.entries()) {
    if (typeof rawName !== "string") {
      return null;
    }
    // 前後の空白だけの名前は空として扱う。vault の食材名の列に空白が並ぶのを避ける。
    const name = rawName.trim();
    const kcalPer100g = parseNumber(kcals[index]);
    const proteinPer100g = parseNumber(proteins[index]);
    const grams = parseNumber(gramsList[index]);
    if (
      name === "" ||
      kcalPer100g === null ||
      proteinPer100g === null ||
      grams === null
    ) {
      return null;
    }
    inputs.push({ name, kcalPer100g, proteinPer100g, grams });
  }
  return inputs;
}

/**
 * 送信された食材名を読む。1 件も無ければ、または 1 件でも空なら null。
 *
 * 繰り返し項目は食材名だけである。推定は 100g あたりの値を返すため量を
 * 必要とせず、長さを突き合わせる相手もない。
 */
function parseFoodNames(formData: FormData): readonly string[] | null {
  const rawNames = formData.getAll("name");
  if (rawNames.length === 0) {
    return null;
  }

  const names: string[] = [];
  for (const rawName of rawNames) {
    if (typeof rawName !== "string") {
      return null;
    }
    // 前後の空白だけの名前は空として扱う。空の名前を推定に送っても値は返らず、
    // 利用者には理由の分からない「推定できなかった」が返るだけになる。
    const name = rawName.trim();
    if (name === "") {
      return null;
    }
    names.push(name);
  }
  return names;
}

/**
 * 送信された日時の文字列を日付と時刻に分解する。
 *
 * 文字列操作だけで分ける。`new Date()` に通すとサーバーの既定のタイムゾーン
 * （Vercel では UTC）で解釈され、日本時間で入力した時刻が記録でずれる。
 */
function parseEatenAt(value: FormDataEntryValue | null): LocalDateTime | null {
  if (typeof value !== "string") {
    return null;
  }
  const matched = EATEN_AT_PATTERN.exec(value);
  if (!matched) {
    return null;
  }
  return { date: matched[1], time: matched[2] };
}

/**
 * 送信された食事区分を読む。推定し直さない。
 *
 * 時刻からの推定はクライアントが行い、ここには確定した値が届く。
 * サーバーで推定し直すと、利用者が自ら選んだ区分を消してしまう
 * （受入基準 3.4）。加えて推定はローカルタイムを見るため、
 * サーバーで行うと区分そのものがずれる。
 */
function parseMealKind(value: FormDataEntryValue | null): MealKind | null {
  if (typeof value !== "string") {
    return null;
  }
  return MEAL_KINDS.find((kind) => kind === value) ?? null;
}

/** 料理名を読む。任意の入力なので、未入力は値なしとして扱う（受入基準 4.7）。 */
function parseDish(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 多層防御として認証を検証する。
 *
 * 遮断点を通っているはずの要求でも、届いた `Authorization` をもう一度確かめる。
 * Server Action は独立したルートではなく記録画面への POST として扱われるため、
 * `proxy` の `matcher` を変えたときに保護が静かに外れうる。守っているのは
 * ページの閲覧ではなく vault への書き込み権限であり、1 層に依存させない。
 *
 * 認証情報が未設定のとき（手元の開発）は検証を省く。有効・無効の決め方を
 * `proxy` と揃えるためである。
 */
async function isAuthorized(): Promise<boolean> {
  const credentials = loadCredentials(process.env);
  if (!credentials) {
    return true;
  }
  const header = (await headers()).get("authorization");
  return verifyCredentials(header, credentials);
}

/**
 * フォームの入力を受けて記録する。`useActionState` から呼ばれる。
 *
 * 判断を持たない。算出は `nutrition`、生成は `note`、書き込みは `vault` に委ねる。
 * ここが持つのは配線と入力の検証だけである。
 *
 * 入力の検証を最初に行う。認証の検証も書き込みも外部に触れるため、
 * 弾ける入力はその前に弾く。
 *
 * 例外は投げない。失敗は戻り値で表す。資格情報は戻り値に含めず、
 * ログにも出さない（受入基準 6.2）。
 *
 * @param _previous 直前の結果。`useActionState` の署名に合わせて受け取るが、
 *   1 回の送信の結果は前回に依存しないため使わない
 */
export async function recordMeal(
  _previous: RecordState,
  formData: FormData,
): Promise<RecordState> {
  const items = parseFoodInputs(formData);
  const eatenAt = parseEatenAt(formData.get("eatenAt"));
  const kind = parseMealKind(formData.get("kind"));
  if (!items || !eatenAt || !kind) {
    return INVALID;
  }

  if (!(await isAuthorized())) {
    // 何も行わない。これが表に出た場合は遮断点の適用範囲が壊れている兆候である。
    return { status: "error", reason: "unauthorized" };
  }

  // 要求ごとに読み出す。資格情報を読むのはこの関数の中だけである。
  const vault = loadVaultConfig(process.env);
  if (!vault) {
    return { status: "error", reason: "config" };
  }

  const record: MealRecord = {
    eatenAt,
    kind,
    dish: parseDish(formData.get("dish")),
    items: items.map(calculateItem),
  };

  const result = await writeNote(
    vault,
    buildFileName(record),
    buildNote(record),
  );
  if (!result.ok) {
    return { status: "error", reason: result.reason };
  }
  return { status: "success", fileName: result.fileName };
}

/**
 * 食材名を受けて 100g あたりの値を推定する。`useActionState` から呼ばれる。
 *
 * 処理の順序は `recordMeal` と同じく **入力の検証 → 認証の再検証 → 資格情報
 * → 推定** である。認証の検証も推定も外部に触れるため、弾ける入力はその前に
 * 弾く。入力の検証を `headers()` より前に置くことで、検証そのものをテストから
 * 確かめられる状態も保たれる。
 *
 * 例外は投げない。失敗は戻り値で表す。資格情報は戻り値に含めず、ログにも
 * 出さない。`reason: "config"` のときも不足しうる変数名を載せない。変数名は
 * 画面が静的な文面として示す（受入基準 6.4）。
 *
 * @param _previous 直前の結果。`useActionState` の署名に合わせて受け取るが、
 *   1 回の推定の結果は前回に依存しないため使わない
 */
export async function estimateFoods(
  _previous: EstimateState,
  formData: FormData,
): Promise<EstimateState> {
  const names = parseFoodNames(formData);
  if (!names) {
    return INVALID_ESTIMATE;
  }

  if (!(await isAuthorized())) {
    // 何も行わない。これが表に出た場合は遮断点の適用範囲が壊れている兆候である。
    return { status: "error", reason: "unauthorized" };
  }

  // 要求ごとに読み出す。無ければ推定を試みない（受入基準 6.5）。キーなしで
  // 要求を組み立てると、設定の不足が資格情報のエラーに化けて原因が分からなくなる。
  const config = loadEstimateConfig(process.env);
  if (!config) {
    return { status: "error", reason: "config" };
  }

  const result = await estimate(config, names);
  if (!result.ok) {
    return { status: "error", reason: result.reason };
  }
  return { status: "success", estimates: result.estimates };
}
