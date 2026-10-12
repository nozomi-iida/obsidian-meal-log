import { afterEach, describe, expect, it, vi } from "vitest";
import { type EstimateConfig, estimate, loadEstimateConfig } from "./estimate";

const config: EstimateConfig = { apiKey: "test-key" };

/** 推定結果として応答の text ブロックに入る JSON 文字列を組み立てる */
function itemsText(items: readonly unknown[]): string {
  return JSON.stringify({ items });
}

/**
 * 成功したときの形の応答を組み立てる。
 *
 * **`content` の先頭に `thinking` ブロックを置く。** アダプティブ思考が既定で
 * 有効なので、実際の応答もこの形になりうる。
 */
function okResponse(text: string, stopReason = "end_turn"): Response {
  return new Response(
    JSON.stringify({
      stop_reason: stopReason,
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text },
      ],
    }),
    { status: 200 },
  );
}

/** 与えた応答を返す `fetch` に差し替える */
function stubFetch(response: Response) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** 与えた理由で throw する `fetch` に差し替える */
function stubFailingFetch(error: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadEstimateConfig", () => {
  it("ANTHROPIC_API_KEY があれば設定を返す", () => {
    expect(loadEstimateConfig({ ANTHROPIC_API_KEY: "sk-test" })).toEqual({
      apiKey: "sk-test",
    });
  });

  it("ANTHROPIC_API_KEY が無いか空なら null を返す", () => {
    expect(loadEstimateConfig({})).toBeNull();
    expect(loadEstimateConfig({ ANTHROPIC_API_KEY: "" })).toBeNull();
  });
});

describe("estimate の要求", () => {
  it("anthropic-version と資格情報を送り、temperature / top_p / top_k を送らない", async () => {
    const mock = stubFetch(
      okResponse(
        itemsText([{ name: "白米", kcal: 156, protein: 2.5, note: "" }]),
      ),
    );

    await estimate(config, ["白米"]);

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body));

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe("test-key");
    expect(body.model).toBe("claude-haiku-5-5");
    // 既定値以外を送ると 400 になるため、3 つとも送ってはいけない
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    // ハングを待たせないためのタイムアウト
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("kcal と protein を nullable にしたスキーマを送る", async () => {
    const mock = stubFetch(
      okResponse(
        itemsText([{ name: "白米", kcal: 156, protein: 2.5, note: "" }]),
      ),
    );

    await estimate(config, ["白米"]);

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const format = body.output_config.format;
    const properties = format.schema.properties.items.items.properties;

    expect(format.type).toBe("json_schema");
    // 「分からない」を構造的に合法な出力にする仕掛けそのもの
    expect(properties.kcal).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    });
    expect(properties.protein).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    });
  });
});

describe("estimate の応答の解釈", () => {
  it("content の先頭が thinking ブロックでも text を取り出せる", async () => {
    stubFetch(
      okResponse(
        itemsText([
          { name: "鶏もも", kcal: 190, protein: 16.6, note: "皮つき" },
        ]),
      ),
    );

    const result = await estimate(config, ["鶏もも"]);

    expect(result).toEqual({
      ok: true,
      estimates: [
        { name: "鶏もも", ok: true, kcalPer100g: 190, proteinPer100g: 16.6 },
      ],
    });
  });

  it("入力と同じ順序で返し、名前は応答ではなく入力の値を使う", async () => {
    stubFetch(
      okResponse(
        itemsText([
          { name: "ちがう名前", kcal: 10, protein: 1, note: "" },
          { name: "白米", kcal: 20, protein: 2, note: "" },
          { name: "納豆", kcal: 30, protein: 3, note: "" },
        ]),
      ),
    );

    const result = await estimate(config, ["鶏もも", "白米", "納豆"]);

    expect(result).toEqual({
      ok: true,
      estimates: [
        { name: "鶏もも", ok: true, kcalPer100g: 10, proteinPer100g: 1 },
        { name: "白米", ok: true, kcalPer100g: 20, proteinPer100g: 2 },
        { name: "納豆", ok: true, kcalPer100g: 30, proteinPer100g: 3 },
      ],
    });
  });

  it("null の要素を ok: false として返し、0 に丸めない", async () => {
    stubFetch(
      okResponse(
        itemsText([
          { name: "肉", kcal: null, protein: null, note: "食材名が曖昧である" },
          { name: "お茶", kcal: 0, protein: 0, note: "" },
          { name: "白米", kcal: 156, protein: null, note: "たんぱく質が不明" },
        ]),
      ),
    );

    const result = await estimate(config, ["肉", "お茶", "白米"]);

    // toEqual は余分なプロパティを許さないので、0 で埋めていないことも示せる。
    // 0 kcal のお茶は ok: true のまま残る
    expect(result).toEqual({
      ok: true,
      estimates: [
        { name: "肉", ok: false, note: "食材名が曖昧である" },
        { name: "お茶", ok: true, kcalPer100g: 0, proteinPer100g: 0 },
        { name: "白米", ok: false, note: "たんぱく質が不明" },
      ],
    });
  });

  it("負の値や有限でない値を含む要素を ok: false として返す", async () => {
    // 1e999 は JSON.parse で Infinity になる。JSON に Infinity の表記は無い
    stubFetch(
      okResponse(
        '{"items":[{"name":"a","kcal":-5,"protein":1,"note":"負の値"},{"name":"b","kcal":1e999,"protein":2,"note":"大きすぎる値"}]}',
      ),
    );

    const result = await estimate(config, ["a", "b"]);

    expect(result).toEqual({
      ok: true,
      estimates: [
        { name: "a", ok: false, note: "負の値" },
        { name: "b", ok: false, note: "大きすぎる値" },
      ],
    });
  });

  it("理由が読めない要素には静的な文面を入れる", async () => {
    stubFetch(
      okResponse(itemsText([{ name: "肉", kcal: null, protein: null }])),
    );

    const result = await estimate(config, ["肉"]);

    expect(result).toEqual({
      ok: true,
      estimates: [{ name: "肉", ok: false, note: "推定できなかった" }],
    });
  });
});

describe("estimate の失敗の分類", () => {
  it("stop_reason が end_turn 以外なら malformed を返す", async () => {
    for (const stopReason of ["refusal", "max_tokens", "tool_use"]) {
      stubFetch(
        okResponse(
          itemsText([{ name: "白米", kcal: 156, protein: 2.5, note: "" }]),
          stopReason,
        ),
      );

      expect(await estimate(config, ["白米"])).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("件数が入力と一致しない応答を malformed として扱う", async () => {
    stubFetch(
      okResponse(
        itemsText([{ name: "白米", kcal: 156, protein: 2.5, note: "" }]),
      ),
    );

    expect(await estimate(config, ["白米", "納豆"])).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("text ブロックが無い応答と JSON でない本文を malformed として扱う", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "thinking", thinking: "" }],
        }),
        { status: 200 },
      ),
    );
    expect(await estimate(config, ["白米"])).toEqual({
      ok: false,
      reason: "malformed",
    });

    stubFetch(okResponse("推定結果は以下の通りです"));
    expect(await estimate(config, ["白米"])).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("401 / 402 / 403 を credential に分類する", async () => {
    for (const status of [401, 402, 403]) {
      stubFetch(new Response("{}", { status }));

      expect(await estimate(config, ["白米"])).toEqual({
        ok: false,
        reason: "credential",
      });
    }
  });

  it("429 / 500 / 504 / 529 を network に分類する", async () => {
    for (const status of [429, 500, 504, 529]) {
      stubFetch(new Response("{}", { status }));

      expect(await estimate(config, ["白米"])).toEqual({
        ok: false,
        reason: "network",
      });
    }
  });

  it("400 / 413 を malformed に分類する", async () => {
    for (const status of [400, 413]) {
      stubFetch(new Response("{}", { status }));

      expect(await estimate(config, ["白米"])).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("fetch の throw を network に分類する", async () => {
    stubFailingFetch(new TypeError("fetch failed"));
    expect(await estimate(config, ["白米"])).toEqual({
      ok: false,
      reason: "network",
    });

    // タイムアウトによる abort も fetch の throw として届く
    stubFailingFetch(
      new DOMException("The operation was aborted", "TimeoutError"),
    );
    expect(await estimate(config, ["白米"])).toEqual({
      ok: false,
      reason: "network",
    });
  });
});
