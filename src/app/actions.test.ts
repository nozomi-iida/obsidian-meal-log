import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordMeal } from "./actions";

/**
 * 正しい形の送信データを組み立てる。各テストは一部だけを差し替える。
 *
 * 食材は同じ名前の項目を繰り返して送る。`<input name="name">` を食材ごとに
 * 並べたフォームがそのまま送れる形である。
 */
function buildFormData(
  overrides: {
    readonly items?: readonly {
      readonly name: string;
      readonly kcalPer100g: string;
      readonly proteinPer100g: string;
      readonly grams: string;
    }[];
    readonly eatenAt?: string;
    readonly kind?: string;
    readonly dish?: string;
  } = {},
): FormData {
  const items = overrides.items ?? [
    {
      name: "鶏むね肉",
      kcalPer100g: "108",
      proteinPer100g: "22",
      grams: "150",
    },
  ];

  const formData = new FormData();
  for (const item of items) {
    formData.append("name", item.name);
    formData.append("kcalPer100g", item.kcalPer100g);
    formData.append("proteinPer100g", item.proteinPer100g);
    formData.append("grams", item.grams);
  }
  formData.set("eatenAt", overrides.eatenAt ?? "2026-10-11T19:00");
  formData.set("kind", overrides.kind ?? "夜");
  formData.set("dish", overrides.dish ?? "");
  return formData;
}

/**
 * 入力の検証だけを対象にする。
 *
 * 検証を通った先には `headers()` と外部への通信があり、どちらもテストからは
 * 動かせない。`headers()` は要求の外で呼ぶと例外を投げるため、ここで
 * 結果が返ることそのものが、認証の検証にも書き込みにも進んでいない証拠になる。
 */
describe("recordMeal", () => {
  beforeEach(() => {
    // 認証情報を設定された状態にする。これがないと認証の検証自体が省かれ、
    // 入力の検証がその前に行われていることを確かめられない。
    vi.stubEnv("BASIC_AUTH_USER", "test-user");
    vi.stubEnv("BASIC_AUTH_PASSWORD", "test-password");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("食材が 0 件の入力を渡すと、書き込みも認証の検証も試みずに入力不正として返る", async () => {
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({ items: [] }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });

  it("数値として解釈できない値を含む入力を渡すと入力不正として返る", async () => {
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({
        items: [
          {
            name: "鶏むね肉",
            kcalPer100g: "108",
            proteinPer100g: "22",
            grams: "ふつう",
          },
        ],
      }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });

  it("数値の欄が空の入力を渡すと入力不正として返る", async () => {
    // 空文字は 0 として解釈できてしまうため、数値以前に弾く必要がある。
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({
        items: [
          {
            name: "鶏むね肉",
            kcalPer100g: "108",
            proteinPer100g: "22",
            grams: "",
          },
        ],
      }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });

  it("食材名が空の入力を渡すと入力不正として返る", async () => {
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({
        items: [
          {
            name: "   ",
            kcalPer100g: "108",
            proteinPer100g: "22",
            grams: "150",
          },
        ],
      }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });

  it("日時がタイムゾーンを持たない形式になっていない入力を渡すと入力不正として返る", async () => {
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({ eatenAt: "2026-10-11T19:00:00Z" }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });

  it("食事区分が 5 つのいずれでもない入力を渡すと入力不正として返る", async () => {
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({ kind: "ブランチ" }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });
});
