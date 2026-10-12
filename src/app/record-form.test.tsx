import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("RecordForm", () => {
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
});
