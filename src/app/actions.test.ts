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
  it("負の数値を含む入力を渡すと入力不正として返る", async () => {
    // 栄養価の算出は 0 以上の値を前提にしている。負の量が通ると負のカロリーが
    // vault に書かれる。画面側でも弾くが、ブラウザの検証を回避した送信を
    // 止められるのはここだけである（多層防御）。
    const negatives = [
      {
        name: "鶏むね肉",
        kcalPer100g: "108",
        proteinPer100g: "22",
        grams: "-150",
      },
      {
        name: "鶏むね肉",
        kcalPer100g: "-108",
        proteinPer100g: "22",
        grams: "150",
      },
      {
        name: "鶏むね肉",
        kcalPer100g: "108",
        proteinPer100g: "-22",
        grams: "150",
      },
    ];

    for (const item of negatives) {
      const state = await recordMeal(
        { status: "idle" },
        buildFormData({ items: [item] }),
      );

      expect(
        state,
        `${item.kcalPer100g} / ${item.proteinPer100g} / ${item.grams}`,
      ).toEqual({ status: "error", reason: "invalid" });
    }
  });
  it("有限でない数値を含む入力を渡すと入力不正として返る", async () => {
    // `Infinity >= 0` は真になる。0 以上の検査だけに頼ると通ってしまい、
    // frontmatter に数値として読めない値が書かれる。
    const state = await recordMeal(
      { status: "idle" },
      buildFormData({
        items: [
          {
            name: "鶏むね肉",
            kcalPer100g: "108",
            proteinPer100g: "22",
            grams: "Infinity",
          },
        ],
      }),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
  });

  it("0 は入力不正として扱わない。条件は 0 以上であり、0 より大きいではない", async () => {
    // 検証を通ると認証の検証（`headers()`）へ進み、要求の外では例外になる。
    // 入力不正として返らずここまで届くことが、0 を通している証拠になる。
    // 画面側は 0 を加えられるため、ここで弾くと「画面で通ってサーバーで
    // 弾かれる」という、利用者に理由の分からない失敗になる。
    await expect(
      recordMeal(
        { status: "idle" },
        buildFormData({
          items: [
            { name: "水", kcalPer100g: "0", proteinPer100g: "0", grams: "0" },
          ],
        }),
      ),
    ).rejects.toThrow("outside a request scope");
  });
});
