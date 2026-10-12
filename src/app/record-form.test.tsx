import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordForm } from "./record-form";

/** 下書きの 4 項目を埋めて「この食材を加える」を押す。 */
function addFood(food: {
  name?: string;
  kcal?: string;
  protein?: string;
  grams?: string;
}) {
  fillDraft(food);
  fireEvent.click(screen.getByRole("button", { name: "この食材を加える" }));
}

/** 下書きの欄を埋める。省略した欄は未入力のまま残す。 */
function fillDraft(food: {
  name?: string;
  kcal?: string;
  protein?: string;
  grams?: string;
}) {
  const fields: readonly [string, string | undefined][] = [
    ["食材名", food.name],
    ["100g あたりのカロリー", food.kcal],
    ["100g あたりのタンパク質", food.protein],
    ["食べた量（g）", food.grams],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
  }
}

/** 食べた時刻の欄を書き換える。値は `YYYY-MM-DDTHH:mm` の形式で渡す。 */
function changeEatenAt(value: string) {
  fireEvent.change(screen.getByLabelText("食べた時刻"), { target: { value } });
}

/** 利用者が食事区分を自ら選ぶ。 */
function chooseKind(value: string) {
  fireEvent.change(screen.getByLabelText("食事区分"), { target: { value } });
}

describe("RecordForm", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("食材を 3 件加えると一覧に並び、合計が各食材の値の和になる", () => {
    render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    addFood({ name: "ごはん", kcal: "156", protein: "2.5", grams: "150" });
    addFood({ name: "ブロッコリー", kcal: "33", protein: "4.3", grams: "50" });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("鶏むね 100g")).toBeInTheDocument();
    expect(screen.getByText("ごはん 150g")).toBeInTheDocument();
    expect(screen.getByText("ブロッコリー 50g")).toBeInTheDocument();

    // 165 + 234 + 17 = 416、23 + 4 + 2 = 29
    expect(screen.getByText("416 kcal / タンパク質 29 g")).toBeInTheDocument();
  });

  it("加えた食材を取り消すと対象から外れ、合計が減る", () => {
    render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("0 kcal / タンパク質 0 g")).toBeInTheDocument();
  });

  it("食材名が空のままでは加えられず、名前が必要であることを示す", () => {
    render(<RecordForm />);

    addFood({ kcal: "165", protein: "23", grams: "100" });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "食材名を入力してください。",
    );
  });

  it("量が未入力のままでは加えられず、数値が必要であることを示す", () => {
    render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23" });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "カロリー・タンパク質・量は数値で入力してください。",
    );
  });

  it("下書きの入力を送信する項目に含めない", () => {
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    // 加えないまま下書きを埋めた状態でも、確定した食材だけが送信の項目になること
    fillDraft({ name: "ごはん", kcal: "156" });

    const form = container.querySelector("form");
    if (!form) {
      throw new Error("form が見つからない");
    }
    const formData = new FormData(form);
    expect(formData.getAll("name")).toEqual(["鶏むね"]);
    expect(formData.getAll("kcalPer100g")).toEqual(["165"]);
    expect(formData.getAll("proteinPer100g")).toEqual(["23"]);
    expect(formData.getAll("grams")).toEqual(["100"]);
  });

  it("画面を開くと現在の時刻が入り、その時刻から推定した区分が示される", () => {
    // Date だけを偽装する。タイマーは本物のまま残し、React の描画に影響させない。
    // 時刻はローカルタイムで組むため、TZ を変えても結果は同じになる。
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 16, 30) });

    render(<RecordForm />);

    expect(screen.getByLabelText("食べた時刻")).toHaveValue("2026-10-11T16:30");
    expect(screen.getByLabelText("食事区分")).toHaveValue("間食");
  });

  it("月・日・時・分が 1 桁のときも 2 桁に 0 埋めして送る", () => {
    // 送信の受付は 2 桁に揃った形式だけを受ける。1 桁のまま送ると、
    // 1〜9 月・1〜9 日・0〜9 時・0〜9 分の食事だけが理由の分からない
    // 入力不正になる（利用者の朝食は 9:30 ごろである）。
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 0, 5, 9, 5) });

    render(<RecordForm />);

    expect(screen.getByLabelText("食べた時刻")).toHaveValue("2026-01-05T09:05");
  });

  it("時刻を変えると食事区分が推定し直される", () => {
    render(<RecordForm />);

    changeEatenAt("2026-10-11T19:00");
    expect(screen.getByLabelText("食事区分")).toHaveValue("夜");

    changeEatenAt("2026-10-11T16:30");
    expect(screen.getByLabelText("食事区分")).toHaveValue("間食");
  });

  it("区分を自ら選んだあとは、時刻を変えても選んだ区分が残る", () => {
    render(<RecordForm />);

    changeEatenAt("2026-10-12T12:30");
    chooseKind("寝る前");
    // 推定では「夜」になる時刻に変えても、利用者の指定を上書きしない
    changeEatenAt("2026-10-12T19:00");

    expect(screen.getByLabelText("食事区分")).toHaveValue("寝る前");
  });

  it("時刻・区分・料理名を送信する項目として持ち、料理名は空でもよい", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 16, 30) });
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });

    const form = container.querySelector("form");
    if (!form) {
      throw new Error("form が見つからない");
    }
    const formData = new FormData(form);
    // 秒もタイムゾーンも付かない形で送る。送信の受付はこの形式だけを受ける
    expect(formData.get("eatenAt")).toBe("2026-10-11T16:30");
    expect(formData.get("kind")).toBe("間食");
    // 料理名の入力は任意（受入基準 4.7）。空のままでも項目としては送られる
    expect(formData.get("dish")).toBe("");
  });
});
