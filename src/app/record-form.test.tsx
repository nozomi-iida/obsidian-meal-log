import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RecordState, recordMeal } from "./actions";
import { RecordForm } from "./record-form";

// 送信の受付だけを差し替える。受付の中身（検証・書き込み）は actions.test.ts が受け持つ。
// ここで確かめるのは、受付に渡る入力と、受付が返した結果の見せ方である。
vi.mock("./actions", () => ({ recordMeal: vi.fn() }));

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

describe("RecordForm", () => {
  beforeEach(() => {
    vi.mocked(recordMeal).mockReset();
    vi.mocked(recordMeal).mockResolvedValue({ status: "idle" });
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
});
