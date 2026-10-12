import { headers } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimate } from "@/lib/estimate";
import { estimateFoods, recordMeal } from "./actions";

/**
 * 推定の呼び出しだけを差し替える。`loadEstimateConfig` は本物のまま使う。
 *
 * 推定を試みなかったことを「呼び出し回数が 0」で確かめるために差し替える。
 * 環境に API キーが無い状態でも `fetch` まで進めば失敗の分類が返ってしまい、
 * 「試みずに止まった」のか「試みて失敗した」のかが区別できない。
 */
vi.mock("@/lib/estimate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/estimate")>();
  return { ...actual, estimate: vi.fn() };
});

/**
 * 要求のヘッダを差し替えられるようにする。既定の挙動は本物に委ねる。
 *
 * 本物は要求の外で呼ぶと例外を投げる。その挙動そのものが「入力の検証が
 * 認証の検証より前にある」ことの証拠になっているため、既定では残す。
 */
vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return { ...actual, headers: vi.fn(actual.headers) };
});

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
/** 認証情報が設定された状態で使う利用者名とパスワード。 */
const TEST_USER = "test-user";
const TEST_PASSWORD = "test-password";

/**
 * 推定の送信データを組み立てる。送るのは食材名の繰り返しだけである。
 *
 * 量は送らない。推定は 100g あたりの値を返すため量を必要とせず、
 * 画面が持っていればよい。
 */
function buildEstimateFormData(names: readonly string[]): FormData {
  const formData = new FormData();
  for (const name of names) {
    formData.append("name", name);
  }
  return formData;
}

/**
 * 認証を通る要求ヘッダに差し替える。
 *
 * これを呼ばないテストでは `headers()` が本物のまま残り、要求の外では例外に
 * なる。認証の検証より後ろへ進んだかどうかが、そこで区別できる。
 */
function stubAuthorizedHeaders(): void {
  const encoded = Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`, "utf8").toString(
    "base64",
  );
  vi.mocked(headers).mockResolvedValue(
    new Headers({ authorization: `Basic ${encoded}` }),
  );
}

/**
 * 処理の順序と、推定を試みたかどうかを対象にする。
 *
 * 順序は **入力の検証 → 認証の再検証 → 資格情報 → 推定** である。各段で
 * 止まったことを、その先に触れていないことで確かめる。
 *
 * - 入力の検証で止まったこと … `headers()` を差し替えずに結果が返ること
 * - 認証で止まったこと … 資格情報が無くても `unauthorized` が返ること
 * - 資格情報で止まったこと … `estimate` の呼び出しが 0 回であること
 *
 * 推定に届いた場合の対照を併せて置く。対照が無いと、差し替えが壊れていて
 * 常に 0 回になっている可能性と区別できない。
 */
describe("estimateFoods", () => {
  beforeEach(() => {
    // 認証情報を設定された状態にする。これがないと認証の検証自体が省かれ、
    // 入力の検証がその前に行われていることを確かめられない。
    vi.stubEnv("BASIC_AUTH_USER", TEST_USER);
    vi.stubEnv("BASIC_AUTH_PASSWORD", TEST_PASSWORD);
    // 推定の資格情報も設定された状態にする。これがないと資格情報の判定で
    // 止まり、その先に推定があることを確かめられない。
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.mocked(estimate).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // 差し替えた `headers()` を本物に戻す。他のテストが頼っている
    // 「要求の外では例外になる」挙動を持ち越さないため。
    vi.mocked(headers).mockReset();
  });

  it("食材名が 0 件の入力を渡すと、認証の検証も推定も試みずに入力不正として返る", async () => {
    const state = await estimateFoods(
      { status: "idle" },
      buildEstimateFormData([]),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
    expect(estimate).not.toHaveBeenCalled();
  });

  it("空の食材名を含む入力を渡すと、認証の検証も推定も試みずに入力不正として返る", async () => {
    // 空白だけの名前も空として扱う。空の名前を送っても値は返らない。
    const state = await estimateFoods(
      { status: "idle" },
      buildEstimateFormData(["鶏もも", "   "]),
    );

    expect(state).toEqual({ status: "error", reason: "invalid" });
    expect(estimate).not.toHaveBeenCalled();
  });

  it("資格情報が設定されていないと、推定を試みずに設定の不足として返る", async () => {
    // 戻り値に変数名を含めない。画面が静的な文面として示す（受入基準 6.4）。
    stubAuthorizedHeaders();
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);

    const state = await estimateFoods(
      { status: "idle" },
      buildEstimateFormData(["鶏もも"]),
    );

    expect(state).toEqual({ status: "error", reason: "config" });
    expect(estimate).not.toHaveBeenCalled();
  });

  it("認証情報が一致しないと、推定を試みずに認証の失敗として返る", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());

    const state = await estimateFoods(
      { status: "idle" },
      buildEstimateFormData(["鶏もも"]),
    );

    expect(state).toEqual({ status: "error", reason: "unauthorized" });
    expect(estimate).not.toHaveBeenCalled();
  });

  it("認証情報が一致しないとき、資格情報が無くても設定の不足を漏らさない", async () => {
    // 認証の検証が資格情報の判定より前にあることを確かめる。順序が逆だと、
    // 認証を通っていない要求に配置環境の設定状況を教えることになる。
    vi.mocked(headers).mockResolvedValue(new Headers());
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);

    const state = await estimateFoods(
      { status: "idle" },
      buildEstimateFormData(["鶏もも"]),
    );

    expect(state).toEqual({ status: "error", reason: "unauthorized" });
  });

  it("認証情報が一致すれば推定に進む。推定を試みない 3 件の対照である", async () => {
    stubAuthorizedHeaders();
    vi.mocked(estimate).mockResolvedValue({ ok: true, estimates: [] });

    await estimateFoods({ status: "idle" }, buildEstimateFormData(["鶏もも"]));

    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it("前後の空白を除いた食材名だけを推定に渡す", async () => {
    stubAuthorizedHeaders();
    vi.mocked(estimate).mockResolvedValue({ ok: true, estimates: [] });

    await estimateFoods(
      { status: "idle" },
      buildEstimateFormData([" 鶏もも ", "白米"]),
    );

    expect(estimate).toHaveBeenCalledWith({ apiKey: "test-key" }, [
      "鶏もも",
      "白米",
    ]);
  });

  it("推定の結果をそのまま返す", async () => {
    stubAuthorizedHeaders();
    const estimates = [
      { name: "鶏もも", ok: true, kcalPer100g: 190, proteinPer100g: 16.6 },
      { name: "惣菜", ok: false, note: "食材を特定できない" },
    ] as const;
    vi.mocked(estimate).mockResolvedValue({ ok: true, estimates });

    const state = await estimateFoods(
      { status: "idle" },
      buildEstimateFormData(["鶏もも", "惣菜"]),
    );

    expect(state).toEqual({ status: "success", estimates });
  });

  it("推定が失敗した理由をそのまま返す", async () => {
    // 分類ごとの文面は画面が決める。受付は分類を落とさずに渡すだけである。
    stubAuthorizedHeaders();
    const failures = ["network", "credential", "malformed"] as const;

    for (const reason of failures) {
      vi.mocked(estimate).mockResolvedValue({ ok: false, reason });

      const state = await estimateFoods(
        { status: "idle" },
        buildEstimateFormData(["鶏もも"]),
      );

      expect(state, reason).toEqual({ status: "error", reason });
    }
  });
});
