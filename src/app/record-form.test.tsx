import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodEstimate } from "@/lib/types";
import {
  type EstimateState,
  estimateFoods,
  type RecordState,
  recordMeal,
} from "./actions";
import { RecordForm } from "./record-form";

// 送信と推定の受付だけを差し替える。受付の中身（検証・書き込み・推定の呼び出し）は
// actions.test.ts が受け持つ。ここで確かめるのは、受付に渡る入力と、受付が
// 返した結果の見せ方である。
vi.mock("./actions", () => ({ recordMeal: vi.fn(), estimateFoods: vi.fn() }));

/** 推定が返す 1 件分の結果。値が決まった状態を作るために使う。 */
const CHICKEN_ESTIMATE: FoodEstimate = {
  name: "鶏もも",
  ok: true,
  kcalPer100g: 190,
  proteinPer100g: 16.6,
};

/** 下書きの 2 項目を埋めて「この食材を加える」を押す。 */
function addEntry(food: { name?: string; grams?: string }) {
  fillDraft(food);
  fireEvent.click(screen.getByRole("button", { name: "この食材を加える" }));
}

/** 下書きの欄を埋める。省略した欄は未入力のまま残す。 */
function fillDraft(food: { name?: string; grams?: string }) {
  const fields: readonly [string, string | undefined][] = [
    ["食材名", food.name],
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

function form(container: HTMLElement): HTMLFormElement {
  const found = container.querySelector("form");
  if (!found) {
    throw new Error("form が見つからない");
  }
  return found;
}

/**
 * 送信する。ボタンを押すのではなく form に submit を起こす。
 *
 * 100g あたりの値はまだ推定できないため、どの食材も値を持たない。送信ボタンは
 * 常に無効であり（受入基準 4.5）、押しても送信が起きない。送信の経路そのものは
 * 壊れていないことを確かめたいので、無効化を迂回した送信として起こす。
 * 無効化が壊れたときに実際に起きるのもこの経路である。
 */
function submitForm(container: HTMLElement) {
  fireEvent.submit(form(container));
}

/** 受付に渡った FormData。送信していなければ落とす。 */
function submittedFormData(): FormData {
  const call = vi.mocked(recordMeal).mock.calls[0];
  if (!call) {
    throw new Error("受付が呼ばれていない");
  }
  return call[1];
}

/**
 * 一覧から食材 1 件の行を引く。
 *
 * 値や理由は行に限定して検査する。画面全体から文面を探すと、一覧の外に
 * 食材名なしで並べても検査が通ってしまい、「どの食材か」が示されていること
 * （受入基準 5.1）を主張できない。
 */
function listItemFor(label: string): HTMLElement {
  const found = screen
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(label));
  if (!found) {
    throw new Error(`${label} の行が見つからない`);
  }
  return found;
}

/**
 * 一覧の 1 行の 100g あたりの欄を引く。
 *
 * 欄は食材ごとに並ぶため、画面全体から引くと同じ名前の欄が複数見つかる。
 * 行に限定して引くことで、どの食材の欄かを取り違えない。
 */
function per100gField(
  label: string,
  field: "カロリー" | "タンパク質",
): HTMLInputElement {
  return within(listItemFor(label)).getByLabelText<HTMLInputElement>(
    `100g あたりの${field}`,
  );
}

/**
 * 一覧の 1 行の 100g あたりの欄を書き換える。
 *
 * 行は書き換えるたびに引き直す。書き換えると再描画が起きるため、
 * 先に引いた要素を使い回すと古い要素に書き込むことになりうる。
 */
function editPer100g(
  label: string,
  values: { kcal?: string; protein?: string },
) {
  const fields: readonly ["カロリー" | "タンパク質", string | undefined][] = [
    ["カロリー", values.kcal],
    ["タンパク質", values.protein],
  ];
  for (const [field, value] of fields) {
    if (value !== undefined) {
      fireEvent.change(per100gField(label, field), { target: { value } });
    }
  }
}

/** 「推定する」ボタン。推定中は文面が変わるため、文面の一部で引く。 */
function estimateButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: /推定/ });
}

/** 推定の受付に渡った FormData。index は何回目の推定かを指す。 */
function estimateFormData(index: number): FormData {
  const call = vi.mocked(estimateFoods).mock.calls[index];
  if (!call) {
    throw new Error("推定の受付が呼ばれていない");
  }
  return call[1];
}

/**
 * 推定を 1 往復させ、加えた食材に 100g あたりの値を入れる。
 *
 * 「記録する」の無効化のうち、食べた時刻が空であることと送信中であることは
 * 値が揃った状態でしか観測できない。値を持たない食材があるとボタンはその
 * 条件だけで無効になり、他の条件の寄与が見えなくなる。
 */
async function runEstimate(estimates: readonly FoodEstimate[]) {
  vi.mocked(estimateFoods).mockResolvedValue({ status: "success", estimates });
  fireEvent.click(estimateButton());
  await waitFor(() =>
    expect(screen.queryAllByText("100g あたりの値がありません")).toHaveLength(
      0,
    ),
  );
}

/**
 * 推定を 1 往復させて失敗させ、status 行に出た文面を確かめる。
 *
 * 文面の一部で待つのは、失敗が画面に出るまで待つ手段が文面しかないためである。
 * 推定中の表示は押した直後に出るため、待つ対象にできない。
 */
async function expectEstimateFailure(
  reason: Extract<EstimateState, { status: "error" }>["reason"],
  expected: string,
) {
  vi.mocked(estimateFoods).mockResolvedValue({ status: "error", reason });
  fireEvent.click(estimateButton());
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(expected),
  );
}

/**
 * 記録を 1 往復させて成功させる。値が揃った食材 1 件を加えた状態から呼ぶ。
 *
 * 入力が初期状態に戻るまで待つ。結果の文面だけを待つと、戻る前の状態を
 * 見てしまうことがある。
 */
async function runSuccessfulRecord(container: HTMLElement) {
  vi.mocked(recordMeal).mockResolvedValue({
    status: "success",
    fileName: "2026-10-11-1630.md",
  });
  fireEvent.click(submitButton(container));
  await waitFor(() =>
    expect(screen.queryAllByRole("listitem")).toHaveLength(0),
  );
}

describe("RecordForm", () => {
  beforeEach(() => {
    vi.mocked(recordMeal).mockReset();
    vi.mocked(recordMeal).mockResolvedValue({ status: "idle" });
    vi.mocked(estimateFoods).mockReset();
    vi.mocked(estimateFoods).mockResolvedValue({ status: "idle" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("100g あたりの値の入力を求めない", () => {
    render(<RecordForm />);

    // 利用者が入力するのは食材名と量の 2 つだけである（受入基準 1.2）
    expect(
      screen.queryByLabelText("100g あたりのカロリー"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("100g あたりのタンパク質"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("食材名")).toBeInTheDocument();
    expect(screen.getByLabelText("食べた量（g）")).toBeInTheDocument();
  });

  it("食材を 3 件加えると一覧に並び、いずれも 100g あたりの値を持たない", () => {
    render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    addEntry({ name: "ごはん", grams: "150" });
    addEntry({ name: "ブロッコリー", grams: "50" });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("鶏むね 100g")).toBeInTheDocument();
    expect(screen.getByText("ごはん 150g")).toBeInTheDocument();
    expect(screen.getByText("ブロッコリー 50g")).toBeInTheDocument();

    // 値が無いことを言葉で示す。空欄にすると 0 と区別がつかない
    expect(screen.getAllByText("100g あたりの値がありません")).toHaveLength(3);
    // 値を持たない食材を 0 として数えない。数えると値が揃っているように見える。
    // 合計が食材ごとの値の和になることは、値を持てるようになってから確かめる
    expect(screen.getByText("0 kcal / タンパク質 0 g")).toBeInTheDocument();
  });

  it("加えた食材を取り消すと対象から外れる", () => {
    render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.getByText("食材を 1 件以上加えると送信できます。"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 kcal / タンパク質 0 g")).toBeInTheDocument();
  });

  it("食材名が空のままでは加えられず、名前が必要であることを示す", () => {
    render(<RecordForm />);

    addEntry({ grams: "100" });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "食材名を入力してください。",
    );
  });

  it("量が未入力のままでは加えられず、数値が必要であることを示す", () => {
    render(<RecordForm />);

    addEntry({ name: "鶏むね" });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "食べた量は 0 以上の数値で入力してください。",
    );
  });

  it("下書きの入力を送信する項目に含めない", () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    // 加えないまま下書きを埋めた状態でも、確定した食材だけが送信の項目になること
    fillDraft({ name: "ごはん", grams: "150" });

    const formData = new FormData(form(container));
    expect(formData.getAll("name")).toEqual(["鶏むね"]);
    expect(formData.getAll("grams")).toEqual(["100"]);
  });

  it("値を持たない食材も 4 項目すべてを並べ、値の無い 2 項目を空で送る", () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    addEntry({ name: "白米", grams: "200" });

    const formData = new FormData(form(container));
    // 4 つの繰り返し項目の長さが揃っていること。揃っていないと受付は組み合わせを
    // 作れず、項目を省くと別の食材の値が隣にずれて入る
    expect(formData.getAll("name")).toEqual(["鶏もも", "白米"]);
    expect(formData.getAll("grams")).toEqual(["300", "200"]);
    expect(formData.getAll("kcalPer100g")).toEqual(["", ""]);
    expect(formData.getAll("proteinPer100g")).toEqual(["", ""]);
  });

  it("値を持たない食材を含む送信を受付が入力不正として扱える形で送る", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    submitForm(container);

    // 空の 2 項目は受付の parseNumber が null を返すため、送信全体が弾かれる。
    // 「記録する」の無効化が壊れても、値の無い記録が vault に書かれない
    await waitFor(() => expect(recordMeal).toHaveBeenCalledTimes(1));
    const formData = submittedFormData();
    expect(formData.getAll("kcalPer100g")).toEqual([""]);
    expect(formData.getAll("proteinPer100g")).toEqual([""]);
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

    addEntry({ name: "鶏むね", grams: "100" });

    const formData = new FormData(form(container));
    // 秒もタイムゾーンも付かない形で送る。送信の受付はこの形式だけを受ける
    expect(formData.get("eatenAt")).toBe("2026-10-11T16:30");
    expect(formData.get("kind")).toBe("間食");
    // 料理名の入力は任意（受入基準 4.7）。空のままでも項目としては送られる
    expect(formData.get("dish")).toBe("");
  });

  it("送信すると確定した食材と時刻・区分・料理名を受付に渡す", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 16, 30) });
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    changeDish("サラダ");
    submitForm(container);

    await waitFor(() => expect(recordMeal).toHaveBeenCalledTimes(1));
    const formData = submittedFormData();
    expect(formData.getAll("name")).toEqual(["鶏むね"]);
    expect(formData.getAll("grams")).toEqual(["100"]);
    expect(formData.get("eatenAt")).toBe("2026-10-11T16:30");
    expect(formData.get("kind")).toBe("間食");
    expect(formData.get("dish")).toBe("サラダ");
  });

  it("100g あたりの値を持たない食材があるときは記録を受け付けない", () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });

    // 値が揃うまで押せない（受入基準 4.5）。押せる状態にしておくと、
    // 受付が返す「入力が不正です」だけが見え、理由が利用者に分からない
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(submitButton(container)).toBeDisabled();
  });

  it("食材が 0 件のとき、または食べた時刻が空のときは送信を受け付けない", () => {
    const { container } = render(<RecordForm />);

    // 対象が 1 件も無いうちは送れない（受入基準 1.6）
    expect(submitButton(container)).toBeDisabled();

    addEntry({ name: "鶏むね", grams: "100" });

    // 時刻が空のまま送ると受付は入力不正を返すが、その理由はどの欄が
    // 悪いかを区別しない。送る前に止める。
    changeEatenAt("");
    expect(submitButton(container)).toBeDisabled();
  });

  it("「推定する」は食材が 0 件のときと、値を持たない食材が無いときは押せない", async () => {
    render(<RecordForm />);

    // 対象が 1 件も無いうちは推定するものがない（受入基準 4.4）
    expect(estimateButton()).toBeDisabled();

    addEntry({ name: "鶏もも", grams: "300" });
    expect(estimateButton()).toBeEnabled();

    await runEstimate([CHICKEN_ESTIMATE]);

    // すでに値を持つ食材は推定し直さない。押せる状態にしておくと通信が
    // 無駄になり、利用者が直した値を上書きする道も開く（受入基準 3.4）
    expect(estimateButton()).toBeDisabled();
  });

  it("「推定する」を押すと値を持たない食材の名前だけが受付に渡る", async () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);
    addEntry({ name: "白米", grams: "200" });
    await runEstimate([
      { name: "白米", ok: true, kcalPer100g: 342, proteinPer100g: 6.1 },
    ]);

    expect(estimateFormData(0).getAll("name")).toEqual(["鶏もも"]);
    // 2 回目は値を持つ鶏ももを含めない（受入基準 2.2）。含めると推定が
    // 決まった値を上書きしうる
    expect(estimateFormData(1).getAll("name")).toEqual(["白米"]);
    // 量は送らない。推定が返すのは 100g あたりの値であり、量は画面が持つ
    expect(estimateFormData(1).getAll("grams")).toEqual([]);
    expect(estimateFormData(1).getAll("kcalPer100g")).toEqual([]);
  });

  it("推定中は推定していることを示し、推定と記録のいずれも受け付けない", async () => {
    let finish: (state: EstimateState) => void = () => {};
    vi.mocked(estimateFoods).mockImplementation(
      () =>
        new Promise<EstimateState>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    fireEvent.click(estimateButton());

    await waitFor(() => expect(estimateButton()).toHaveTextContent("推定中"));
    // 重ねての推定を受け付けない（受入基準 4.2）
    expect(estimateButton()).toBeDisabled();
    // 推定中は記録も受け付けない（受入基準 4.3）
    expect(submitButton(container)).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("推定中");

    finish({ status: "success", estimates: [CHICKEN_ESTIMATE] });
    await waitFor(() => expect(estimateButton()).toHaveTextContent("推定する"));
  });

  it("値が揃っていても推定中は記録を受け付けない", async () => {
    let finish: (state: EstimateState) => void = () => {};
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    vi.mocked(estimateFoods).mockImplementation(
      () =>
        new Promise<EstimateState>((resolve) => {
          finish = resolve;
        }),
    );
    addEntry({ name: "白米", grams: "200" });
    fireEvent.click(estimateButton());
    await waitFor(() => expect(estimateButton()).toHaveTextContent("推定中"));

    // 推定中に値を持たない食材を取り消す。値の不足が無くなるため、
    // 「記録する」が無効である理由は推定中であることだけになる（受入基準 4.3）
    fireEvent.click(screen.getAllByRole("button", { name: "取り消す" })[1]);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(submitButton(container)).toBeDisabled();

    // 未解決のまま残すと、後続のテストの更新が止まる
    finish({ status: "success", estimates: [] });
    await waitFor(() => expect(estimateButton()).toHaveTextContent("推定する"));
  });

  it("同じ食材名を 2 件加えても、それぞれの推定の結果が取り違わらない", async () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    addEntry({ name: "鶏もも", grams: "100" });
    await runEstimate([
      CHICKEN_ESTIMATE,
      { name: "鶏もも", ok: true, kcalPer100g: 300, proteinPer100g: 20 },
    ]);

    // 結果は求めた順に返る。食材名で突き合わせると 2 件目に 1 件目の値が入る。
    // 量が違うため、取り違えると換算後の値も 100g あたりの値も入れ替わる
    expect(per100gField("鶏もも 300g", "カロリー")).toHaveValue(190);
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveValue(16.6);
    expect(per100gField("鶏もも 100g", "カロリー")).toHaveValue(300);
    expect(per100gField("鶏もも 100g", "タンパク質")).toHaveValue(20);
    expect(
      within(listItemFor("鶏もも 300g")).getByText(
        "この量で 570 kcal / タンパク質 50 g",
      ),
    ).toBeInTheDocument();
    expect(
      within(listItemFor("鶏もも 100g")).getByText(
        "この量で 300 kcal / タンパク質 20 g",
      ),
    ).toBeInTheDocument();
  });

  it("値が揃っていても食べた時刻が空のときは記録を受け付けない", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    // 値が揃えば押せる。ここから先の無効化は時刻だけが理由になる
    expect(submitButton(container)).toBeEnabled();

    changeEatenAt("");
    expect(submitButton(container)).toBeDisabled();
  });

  it("送信中は「記録する」が押せず、重ねての送信が受付に届かない", async () => {
    let finish: (state: RecordState) => void = () => {};
    vi.mocked(recordMeal).mockImplementation(
      () =>
        new Promise<RecordState>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    fireEvent.click(submitButton(container));
    await waitFor(() => expect(recordMeal).toHaveBeenCalledTimes(1));

    expect(submitButton(container)).toBeDisabled();
    // 重ねての送信を止めているのは disabled だけである（submit に送信中の
    // ガードは無い）。2 回目を押しても受付に届かないことを確かめる
    fireEvent.click(submitButton(container));
    expect(recordMeal).toHaveBeenCalledTimes(1);

    finish({ status: "success", fileName: "2026-10-11-1630.md" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("記録しました"),
    );
  });

  it("送信中は送信中であることを示し、送信を受け付けない状態にする", async () => {
    let finish: (state: RecordState) => void = () => {};
    vi.mocked(recordMeal).mockImplementation(
      () =>
        new Promise<RecordState>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    submitForm(container);

    await waitFor(() =>
      expect(submitButton(container)).toHaveTextContent("送信中"),
    );
    expect(submitButton(container)).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("送信中");

    finish({ status: "success", fileName: "2026-10-11-1630.md" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("記録しました"),
    );
  });

  it("記録が成功すると成功したことと作成したファイルの名前を示す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "success",
      fileName: "2026-10-11-1630.md",
    });
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    submitForm(container);

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
    addEntry({ name: "鶏もも", grams: "400" });
    submitForm(container);

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
  });

  it("権限で失敗したときはトークンの期限を疑えることを示す", async () => {
    vi.mocked(recordMeal).mockResolvedValue({
      status: "error",
      reason: "permission",
    });
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "100" });
    submitForm(container);

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

    addEntry({ name: "鶏むね", grams: "100" });
    submitForm(container);

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

    addEntry({ name: "鶏むね", grams: "100" });
    submitForm(container);

    // 戻り値は変数名を持たない（資格情報に関わる情報を載せないため）。
    // 画面側が静的な文面として持つ（受入基準 6.3）。
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("VAULT_OWNER");
      expect(status).toHaveTextContent("VAULT_REPO");
      expect(status).toHaveTextContent("VAULT_TOKEN");
    });
  });

  it("負の数値では加えられず、0 以上であることを示す", () => {
    // 量が負だと負のカロリーが vault に書かれる。画面側で弾いて早く伝える。
    render(<RecordForm />);

    addEntry({ name: "鶏むね", grams: "-100" });

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("0 以上");
  });

  it("0 は加えられる。条件は 0 以上であり、0 より大きいではない", () => {
    render(<RecordForm />);

    addEntry({ name: "水", grams: "0" });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("水 0g")).toBeInTheDocument();
  });

  it("数値の欄は 0 未満を入力できない状態にする", () => {
    render(<RecordForm />);

    // ブラウザ側の 1 層目。回避された送信は受付が弾く。
    expect(screen.getByLabelText("食べた量（g）")).toHaveAttribute("min", "0");
  });

  it("記録が成功すると入力が初期状態に戻り、結果の表示だけが残る", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 11, 16, 30) });
    vi.mocked(recordMeal).mockResolvedValue({
      status: "success",
      fileName: "2026-10-11-1900.md",
    });
    const { container } = render(<RecordForm />);

    changeEatenAt("2026-10-11T19:00");
    chooseKind("寝る前");
    changeDish("鍋");
    addEntry({ name: "鶏もも", grams: "400" });
    // 下書きの指摘が出ている状態から送る。成功後まで残すと、何も入力して
    // いない欄に対する指摘が居座る。量を空のまま加えようとして指摘を出す
    addEntry({ name: "ごはん" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // 送信の直前に時計を進める。時刻が「画面を開いたときの値のまま」ではなく
    // 「現在時刻に戻る」ことを区別するためで、1 桁の月日時分で 0 埋めも押さえる。
    vi.setSystemTime(new Date(2026, 0, 5, 9, 5));
    submitForm(container);

    // 入力が戻るのは結果の表示より 1 描画あと（効果が走ってから）になる。
    // 結果の表示を待っただけでは、戻る前の状態を見てしまうことがある。
    await waitFor(() =>
      expect(screen.queryAllByRole("listitem")).toHaveLength(0),
    );

    expect(screen.getByLabelText("料理名（任意）")).toHaveValue("");
    expect(screen.getByLabelText("食べた時刻")).toHaveValue("2026-01-05T09:05");
    // 区分は戻した時刻から推定し直す（9:05 なら朝）
    expect(screen.getByLabelText("食事区分")).toHaveValue("朝");
    // 下書きも、下書きに対する指摘も空に戻す
    expect(screen.getByLabelText("食材名")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 結果は残す。受入基準 5.2 が作成したファイル名を示すことを求めている
    expect(screen.getByRole("status")).toHaveTextContent("記録しました");
    expect(screen.getByRole("status")).toHaveTextContent("2026-10-11-1900.md");

    // 利用者が選んだ区分の指定も解除する。解除しないと、次の記録では
    // 時刻を変えても前回選んだ区分が残り続ける（受入基準 3.3 が効かない）
    changeEatenAt("2026-01-05T19:00");
    expect(screen.getByLabelText("食事区分")).toHaveValue("夜");
  });

  // 失敗の分類ごとに、利用者が次に何をすればよいかが分かる語を含むこと。
  // 分類の網羅は型（`Record<分類, string>`）が強制するが、文面が対処を
  // 示しているかは型からは分からない。
  it.each([
    ["network", "時間を置いて"],
    ["credential", "開発者に伝えて"],
    ["malformed", "もう一度"],
    ["config", "ANTHROPIC_API_KEY"],
    ["invalid", "食材名"],
    ["unauthorized", "遮断点"],
  ] as const)(
    "推定が %s で失敗したときは対処が分かる文面を示す",
    async (reason, expected) => {
      render(<RecordForm />);

      addEntry({ name: "鶏もも", grams: "300" });
      await expectEstimateFailure(reason, expected);

      // 失敗しても入力した内容を破棄せず、やり直せる状態を保つ（受入基準 5.4）
      expect(screen.getByText("鶏もも 300g")).toBeInTheDocument();
    },
  );

  it("推定の資格情報が不足しているときは変数名を画面側が示す", async () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    // 戻り値は変数名を持たない（資格情報に関わる情報を載せないため）。
    // 画面側が静的な文面として持つ（受入基準 6.3）
    await expectEstimateFailure("config", "ANTHROPIC_API_KEY");
  });

  it("推定が終わると 100g あたりの値・食材ごとの値・合計の 3 つを示す", async () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    // 100g あたりの値を示す（受入基準 2.7）。推定の品質が落ちたことに気づく
    // 手段は利用者が値を見ることだけである。送信の項目にしか無い状態では、
    // 1 桁ずれた値でも換算後の数字からは見分けられない
    expect(per100gField("鶏もも 300g", "カロリー")).toHaveValue(190);
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveValue(16.6);
    // 食材ごとの換算後の値も同じ行に示す
    expect(
      within(listItemFor("鶏もも 300g")).getByText(
        /570 kcal \/ タンパク質 50 g/,
      ),
    ).toBeInTheDocument();
    // 合計は一覧の外に出す。食材が 1 件のときは同じ数字になるため、行の中と
    // 区別して引く
    expect(screen.getByText("570 kcal / タンパク質 50 g")).toBeInTheDocument();
  });

  it("一部だけ推定できなかったとき、理由を示し、推定できた食材の値を残す", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    addEntry({ name: "肉", grams: "100" });
    addEntry({ name: "白米", grams: "200" });
    vi.mocked(estimateFoods).mockResolvedValue({
      status: "success",
      estimates: [
        CHICKEN_ESTIMATE,
        // 理由の文面に食材名を含めない。含めると、理由を食材名と同じ行に
        // 置かず画面のどこかに並べただけでも検査が通ってしまう
        { name: "肉", ok: false, note: "部位や種類が特定できない" },
        { name: "白米", ok: true, kcalPer100g: 342, proteinPer100g: 6.1 },
      ],
    });
    fireEvent.click(estimateButton());

    // どの食材が推定できなかったかと、モデルが返した理由をそのまま示す
    // （受入基準 5.1）。理由はその食材の行の中にあること
    await waitFor(() =>
      expect(
        within(listItemFor("肉 100g")).getByText(
          "推定できませんでした。部位や種類が特定できない",
        ),
      ).toBeInTheDocument(),
    );

    // 1 件の失敗で推定できた食材の値を失わない（受入基準 5.5）
    expect(per100gField("鶏もも 300g", "カロリー")).toHaveValue(190);
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveValue(16.6);
    expect(
      within(listItemFor("鶏もも 300g")).getByText(
        "この量で 570 kcal / タンパク質 50 g",
      ),
    ).toBeInTheDocument();
    expect(per100gField("白米 200g", "カロリー")).toHaveValue(342);
    expect(per100gField("白米 200g", "タンパク質")).toHaveValue(6.1);
    expect(
      within(listItemFor("白米 200g")).getByText(
        "この量で 684 kcal / タンパク質 12 g",
      ),
    ).toBeInTheDocument();
    // 合計は値を持つ食材だけの和である。推定できなかった食材を 0 として数えない
    expect(screen.getByText("1254 kcal / タンパク質 62 g")).toBeInTheDocument();
    // 値が揃っていない食材が残るため記録は受け付けない（受入基準 4.5）
    expect(submitButton(container)).toBeDisabled();
    // 件数も読み上げられる領域に出す。一覧を見ない利用者にも失敗が届くように
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 件は推定できませんでした",
    );
  });

  it("記録に成功したあとに推定が失敗すると、記録の結果が残らない", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);
    await runSuccessfulRecord(container);
    expect(screen.getByRole("status")).toHaveTextContent("記録しました");

    addEntry({ name: "肉", grams: "100" });
    await expectEstimateFailure("network", "時間を置いて");

    // 記録の結果が残ると、推定の失敗が成功のように見える
    expect(screen.getByRole("status")).not.toHaveTextContent("記録しました");
  });

  it("記録に成功したあとに推定が成功すると、記録の結果が残らない", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);
    await runSuccessfulRecord(container);
    expect(screen.getByRole("status")).toHaveTextContent("記録しました");

    addEntry({ name: "白米", grams: "200" });
    await runEstimate([
      { name: "白米", ok: true, kcalPer100g: 342, proteinPer100g: 6.1 },
    ]);

    // 示す結果は常に最後に押したボタンのものである
    expect(screen.getByRole("status")).toHaveTextContent("推定しました");
    expect(screen.getByRole("status")).not.toHaveTextContent("記録しました");
  });

  it("100g あたりの値を直すと、その食材の値と合計を算出し直す", async () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    // 推定した値は修正できる形で示す（受入基準 3.1）。読み取り専用で出すと、
    // 実感と違う値をそのまま記録するしかなくなる
    expect(per100gField("鶏もも 300g", "カロリー")).toHaveValue(190);
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveValue(16.6);

    editPer100g("鶏もも 300g", { kcal: "100", protein: "20" });

    // その食材の値（受入基準 3.2）
    expect(
      within(listItemFor("鶏もも 300g")).getByText(
        "この量で 300 kcal / タンパク質 60 g",
      ),
    ).toBeInTheDocument();
    // 合計（受入基準 3.3）。行の文面とは完全一致で区別する
    expect(screen.getByText("300 kcal / タンパク質 60 g")).toBeInTheDocument();
  });

  it("値を手で直したあとに食材を足して推定しても、直した値が変わらない", async () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);
    editPer100g("鶏もも 300g", { kcal: "150" });

    addEntry({ name: "白米", grams: "200" });
    await runEstimate([
      { name: "白米", ok: true, kcalPer100g: 342, proteinPer100g: 6.1 },
    ]);

    // 利用者が決めた値を推定で上書きしない（受入基準 3.4）。この機能で
    // いちばん重要な振る舞いである
    expect(per100gField("鶏もも 300g", "カロリー")).toHaveValue(150);
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveValue(16.6);
    // 上書きを条件分岐で防ぐのではなく、推定の対象に入れないことで防ぐ。
    // 対象に入れてしまうと、通信も無駄になり上書きの道も開く
    expect(estimateFormData(1).getAll("name")).toEqual(["白米"]);
    // 合計も直した値で出る（鶏もも 450 kcal / P50、白米 684 kcal / P12）
    expect(screen.getByText("1134 kcal / タンパク質 62 g")).toBeInTheDocument();
  });

  it("推定の結果が返る前に値を直すと、返った値で上書きしない", async () => {
    let finish: (state: EstimateState) => void = () => {};
    vi.mocked(estimateFoods).mockImplementation(
      () =>
        new Promise<EstimateState>((resolve) => {
          finish = resolve;
        }),
    );
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    addEntry({ name: "白米", grams: "200" });
    fireEvent.click(estimateButton());
    await waitFor(() => expect(estimateButton()).toHaveTextContent("推定中"));

    // 推定を待つあいだに利用者が値を入れる。求めたときは対象だったため、
    // 結果を反映する側で利用者が決めた食材を飛ばさないと上書きされる
    editPer100g("鶏もも 300g", { kcal: "150" });
    finish({
      status: "success",
      estimates: [
        CHICKEN_ESTIMATE,
        { name: "白米", ok: true, kcalPer100g: 342, proteinPer100g: 6.1 },
      ],
    });

    // 反映が済んだことを、利用者が触っていない食材の値で待つ。ボタンの文面が
    // 戻る描画は反映の効果より前なので、文面で待つと反映前の DOM を読み、
    // 上書きされていても気づけない。
    await waitFor(() =>
      expect(per100gField("白米 200g", "カロリー")).toHaveValue(342),
    );

    expect(per100gField("鶏もも 300g", "カロリー")).toHaveValue(150);
    // 片方しか入れていない欄も埋めない。利用者が決めた食材には触らない
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveValue(null);
  });

  it("値を手で直した食材は推定の対象に入らない", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    // 欄を空にする。値は無いが、利用者が自ら決めた欄である
    editPer100g("鶏もも 300g", { kcal: "" });

    // 値が無いので記録はできない（受入基準 4.5）
    expect(submitButton(container)).toBeDisabled();
    // それでも推定で埋め直さない（受入基準 3.4）。埋め直すと、利用者が
    // 消した値が推定の値に戻る
    expect(estimateButton()).toBeDisabled();
  });

  it("直した 100g あたりの値が不正なら記録を受け付けず、入力が不正であることを示す", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });
    await runEstimate([CHICKEN_ESTIMATE]);

    // 0 未満の値（受入基準 3.5）。負のカロリーが vault に書かれる
    editPer100g("鶏もも 300g", { kcal: "-50" });
    expect(submitButton(container)).toBeDisabled();
    expect(
      within(listItemFor("鶏もも 300g")).getByText(
        "100g あたりの値は 0 以上の数値で入力してください。",
      ),
    ).toBeInTheDocument();

    // 数値として読めない値。`type="number"` の欄は読めない入力を空文字として
    // 返すため、利用者が実際に踏むのはこの経路である
    editPer100g("鶏もも 300g", { kcal: "" });
    expect(submitButton(container)).toBeDisabled();
    expect(
      within(listItemFor("鶏もも 300g")).getByText(
        "100g あたりの値は 0 以上の数値で入力してください。",
      ),
    ).toBeInTheDocument();
  });

  it("100g あたりの 0 は受け付ける。条件は 0 以上であり、0 より大きいではない", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "お茶", grams: "300" });
    await runEstimate([
      { name: "お茶", ok: true, kcalPer100g: 0, proteinPer100g: 0 },
    ]);

    // 0 kcal の食品（水、お茶）は正当な入力である
    expect(submitButton(container)).toBeEnabled();
    editPer100g("お茶 300g", { kcal: "0", protein: "0" });
    expect(submitButton(container)).toBeEnabled();
    expect(
      within(listItemFor("お茶 300g")).getByText(
        "この量で 0 kcal / タンパク質 0 g",
      ),
    ).toBeInTheDocument();
  });

  it("100g あたりの数値欄は 0 未満を入力できない状態にする", () => {
    render(<RecordForm />);

    addEntry({ name: "鶏もも", grams: "300" });

    // ブラウザ側の 1 層目。回避された送信は受付が弾く
    expect(per100gField("鶏もも 300g", "カロリー")).toHaveAttribute("min", "0");
    expect(per100gField("鶏もも 300g", "タンパク質")).toHaveAttribute(
      "min",
      "0",
    );
  });

  it("推定できなかった食材に手で値を入力し、その値で記録できる", async () => {
    const { container } = render(<RecordForm />);

    addEntry({ name: "肉", grams: "100" });
    vi.mocked(estimateFoods).mockResolvedValue({
      status: "success",
      estimates: [{ name: "肉", ok: false, note: "部位や種類が特定できない" }],
    });
    fireEvent.click(estimateButton());

    // 推定できなかった食材にも手で入力する手段を示す（受入基準 5.2）。
    // 理由の文面は残す。どの食材がなぜ推定できなかったかは引き続き分かる
    await waitFor(() =>
      expect(
        within(listItemFor("肉 100g")).getByText(
          "推定できませんでした。部位や種類が特定できない",
        ),
      ).toBeInTheDocument(),
    );
    expect(per100gField("肉 100g", "カロリー")).toHaveValue(null);

    editPer100g("肉 100g", { kcal: "200", protein: "20" });
    expect(
      within(listItemFor("肉 100g")).getByText(
        "この量で 200 kcal / タンパク質 20 g",
      ),
    ).toBeInTheDocument();

    // 手で入力した値で記録できる（受入基準 5.3, 3.6）
    vi.mocked(recordMeal).mockResolvedValue({
      status: "success",
      fileName: "2026-10-11-1630.md",
    });
    expect(submitButton(container)).toBeEnabled();
    fireEvent.click(submitButton(container));

    await waitFor(() => expect(recordMeal).toHaveBeenCalledTimes(1));
    const formData = submittedFormData();
    expect(formData.getAll("name")).toEqual(["肉"]);
    expect(formData.getAll("kcalPer100g")).toEqual(["200"]);
    expect(formData.getAll("proteinPer100g")).toEqual(["20"]);
    expect(formData.getAll("grams")).toEqual(["100"]);
  });
});
