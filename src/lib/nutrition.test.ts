import { describe, expect, it } from "vitest";
import { calculateItem, sumNutrition } from "./nutrition";
import type { FoodInput } from "./types";

// 白米はタンパク質が 7.5 に、ブロッコリーは 2.5 になる量を選んでいる。
// 四捨五入が働いていること、丸める前の値を足していないことが結果に表れる。
const rice: FoodInput = {
  name: "白米",
  kcalPer100g: 156,
  proteinPer100g: 2.5,
  grams: 300,
};

const broccoli: FoodInput = {
  name: "ブロッコリー",
  kcalPer100g: 36,
  proteinPer100g: 5,
  grams: 50,
};

describe("calculateItem", () => {
  it("100g あたりの値と量から整数に丸めた栄養価を返す", () => {
    expect(calculateItem(rice)).toEqual({
      name: "白米",
      grams: 300,
      kcal: 468,
      // 7.5 を四捨五入した値。切り捨てなら 7 になる
      protein: 8,
    });

    const result = calculateItem(broccoli);
    expect(Number.isInteger(result.kcal)).toBe(true);
    expect(Number.isInteger(result.protein)).toBe(true);
  });
});

describe("sumNutrition", () => {
  it("丸めた食材ごとの値の和を返す", () => {
    const items = [calculateItem(rice), calculateItem(broccoli)];

    // タンパク質は 8 + 3 = 11。丸める前の 7.5 + 2.5 = 10 を丸めた値ではない
    expect(sumNutrition(items)).toEqual({ kcal: 486, protein: 11 });
  });
});
