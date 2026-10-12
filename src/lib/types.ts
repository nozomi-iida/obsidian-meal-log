/** 利用者が入力した食材。100g あたりの概算値も量も入力値である。 */
export type FoodInput = {
  readonly name: string;
  readonly kcalPer100g: number;
  readonly proteinPer100g: number;
  readonly grams: number;
};

/** 記録の対象に加えた食材。量が決まり、栄養価は整数に丸められている。 */
export type MealItem = {
  readonly name: string;
  readonly grams: number;
  readonly kcal: number;
  readonly protein: number;
};

/**
 * 食事区分。
 *
 * 文字列リテラルの合併にするのは、vault に書く値がそのまま Obsidian の
 * 絞り込みに使われるためである。表記を型で固定する。
 */
export type MealKind = "朝" | "昼" | "夜" | "間食" | "寝る前";

/** 記録 1 件の内容。 */
export type MealRecord = {
  readonly eatenAt: Date;
  readonly kind: MealKind;
  readonly dish: string | null;
  readonly items: readonly MealItem[];
};
