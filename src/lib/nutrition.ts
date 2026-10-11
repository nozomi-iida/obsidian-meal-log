import type { FoodInput, MealItem } from "./types";

/**
 * 100g あたりの値を量に合わせて換算し、四捨五入で整数に丸める。
 *
 * 切り捨てだと常に低く出て、タンパク質の目標の達成判定が実際より
 * 厳しく見える。そのため四捨五入とする。
 */
function scaleAndRound(per100g: number, grams: number): number {
  return Math.round((per100g * grams) / 100);
}

/**
 * 入力された 100g あたりの値と量から、整数に丸めた栄養価を出す。
 *
 * 記録フォームが合計の表示に使い、ノートの生成が frontmatter の値に使う。
 * 同じ関数を通すことで、画面に出る数字と vault に書かれる数字が一致する。
 */
export function calculateItem(input: FoodInput): MealItem {
  return {
    name: input.name,
    grams: input.grams,
    kcal: scaleAndRound(input.kcalPer100g, input.grams),
    protein: scaleAndRound(input.proteinPer100g, input.grams),
  };
}

/**
 * 丸めた食材ごとの値を合計する。
 *
 * 丸める前の値から合計を出し直さない。本文に並べた数字を足せば
 * frontmatter の合計になるという関係を保つため。
 */
export function sumNutrition(items: readonly MealItem[]): {
  readonly kcal: number;
  readonly protein: number;
} {
  return items.reduce(
    (total, item) => ({
      kcal: total.kcal + item.kcal,
      protein: total.protein + item.protein,
    }),
    { kcal: 0, protein: 0 },
  );
}
