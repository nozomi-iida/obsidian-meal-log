import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecordState, recordMeal } from "./actions";
import { RecordForm } from "./record-form";

// 送信の受付だけを差し替える。受付の中身（検証・書き込み）は actions.test.ts が受け持つ。
// ここで確かめるのは、受付に渡る入力と、受付が返した結果の見せ方である。
vi.mock("./actions", () => ({ recordMeal: vi.fn() }));

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

/** 料理名の欄を書き換える。 */
function changeDish(value: string) {
  fireEvent.change(screen.getByLabelText("料理名（任意）"), {
    target: { value },
  });
}

/** 送信ボタン。送信中は文面が変わるため、文面ではなく種類で引く。 */
function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (!button) {
    throw new Error("送信ボタンが見つからない");
  }
  return button;
}

/** 受付に渡った FormData。送信していなければ落とす。 */
function submittedFormData(): FormData {
  const call = vi.mocked(recordMeal).mock.calls[0];
  if (!call) {
    throw new Error("受付が呼ばれていない");
  }
  return call[1];
}

describe("RecordForm", () => {
  beforeEach(() => {
    vi.mocked(recordMeal).mockReset();
    vi.mocked(recordMeal).mockResolvedValue({ status: "idle" });
  });

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

  it("送信すると確定した食材と時刻・区分・料理名を受付に渡す", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 16, 30) });
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    changeDish("サラダ");
    fireEvent.click(submitButton(container));

    await waitFor(() => expect(recordMeal).toHaveBeenCalledTimes(1));
    const formData = submittedFormData();
    expect(formData.getAll("name")).toEqual(["鶏むね"]);
    expect(formData.getAll("grams")).toEqual(["100"]);
    expect(formData.get("eatenAt")).toBe("2026-10-11T16:30");
    expect(formData.get("kind")).toBe("間食");
    expect(formData.get("dish")).toBe("サラダ");
  });

  it("食材が 0 件のとき、または食べた時刻が空のときは送信を受け付けない", () => {
    const { container } = render(<RecordForm />);

    // 対象が 1 件も無いうちは送れない（受入基準 1.6）
    expect(submitButton(container)).toBeDisabled();

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    expect(submitButton(container)).toBeEnabled();

    // 時刻が空のまま送ると受付は入力不正を返すが、その理由はどの欄が
    // 悪いかを区別しない。送る前に止める。
    changeEatenAt("");
    expect(submitButton(container)).toBeDisabled();
  });

  it("送信中は送信中であることを示し、重ねての送信を受け付けない", async () => {
    let finish: (state: RecordState) => void = () => {};
    vi.mocked(recordMeal).mockImplementation(
      () =>
        new Promise<RecordState>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    fireEvent.click(submitButton(container));

    await waitFor(() => expect(submitButton(container)).toBeDisabled());
    expect(submitButton(container)).toHaveTextContent("送信中");
    expect(screen.getByRole("status")).toHaveTextContent("送信中");

    // 重ねて押しても 2 回目は受付に届かない（受入基準 5.1）
    fireEvent.click(submitButton(container));
    expect(recordMeal).toHaveBeenCalledTimes(1);

    finish({ status: "success", fileName: "2026-10-11-1630.md" });
    await waitFor(() => expect(submitButton(container)).toBeEnabled());
  });

  it("記録が成功すると成功したことと作成したファイルの名前を示す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "success",
      fileName: "2026-10-11-1630.md",
    });
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    fireEvent.click(submitButton(container));

    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("記録しました");
      expect(status).toHaveTextContent("2026-10-11-1630.md");
    });
  });

  it("重複したときは時刻を変えれば解決することを示し、入力した内容を残す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "error",
      reason: "duplicate",
    });
    const { container } = render(<RecordForm />);

    changeEatenAt("2026-10-11T19:00");
    chooseKind("寝る前");
    changeDish("鍋");
    addFood({ name: "鶏もも", kcal: "200", protein: "17", grams: "400" });
    fireEvent.click(submitButton(container));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "食べた時刻を変えて",
      ),
    );

    // 失敗しても入力した内容を破棄せず、やり直せる状態を保つ（受入基準 5.4）
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("鶏もも 400g")).toBeInTheDocument();
    expect(screen.getByLabelText("食べた時刻")).toHaveValue("2026-10-11T19:00");
    expect(screen.getByLabelText("食事区分")).toHaveValue("寝る前");
    expect(screen.getByLabelText("料理名（任意）")).toHaveValue("鍋");
    expect(submitButton(container)).toBeEnabled();
  });

  it("権限で失敗したときはトークンの期限を疑えることを示す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "error",
      reason: "permission",
    });
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    fireEvent.click(submitButton(container));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("期限"),
    );
  });

  it("通信で失敗したときは時間を置いてやり直せることを示す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "error",
      reason: "network",
    });
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    fireEvent.click(submitButton(container));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("時間を置いて"),
    );
  });

  it("設定が不足しているときは不足しうる変数名を画面側が示す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "error",
      reason: "config",
    });
    const { container } = render(<RecordForm />);

    addFood({ name: "鶏むね", kcal: "165", protein: "23", grams: "100" });
    fireEvent.click(submitButton(container));

    // 戻り値は変数名を持たない（資格情報に関わる情報を載せないため）。
    // 画面側が静的な文面として持つ（受入基準 6.3）。
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("VAULT_OWNER");
      expect(status).toHaveTextContent("VAULT_REPO");
      expect(status).toHaveTextContent("VAULT_TOKEN");
    });
  });
});
