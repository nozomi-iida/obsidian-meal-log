import { describe, expect, it } from "vitest";
import { buildFileName, buildNote } from "./note";
import { calculateItem } from "./nutrition";
import type { MealRecord } from "./types";

// 白米はタンパク質が 7.5、ブロッコリーは 2.5 になる量を選んでいる。
// 丸めた値を足しているのか、丸める前の値から合計を出し直しているのかが
// 結果に表れる（丸めてから足すと 87、足してから丸めると 86）。
const items = [
  calculateItem({
    name: "白米",
    kcalPer100g: 156,
    proteinPer100g: 2.5,
    grams: 300,
  }),
  calculateItem({
    name: "鶏もも",
    kcalPer100g: 113,
    proteinPer100g: 19,
    grams: 400,
  }),
  calculateItem({
    name: "ブロッコリー",
    kcalPer100g: 36,
    proteinPer100g: 5,
    grams: 50,
  }),
];

const record: MealRecord = {
  eatenAt: { date: "2026-10-11", time: "21:00" },
  kind: "夜",
  dish: "鍋",
  items,
};

/** frontmatter を項目の並び順を保ったまま取り出す。 */
function parseFrontmatter(note: string): ReadonlyArray<[string, string]> {
  const lines = note.split("\n");
  expect(lines[0]).toBe("---");

  const end = lines.indexOf("---", 1);
  expect(end).toBeGreaterThan(0);

  return lines.slice(1, end).map((line) => {
    const separator = line.indexOf(":");
    expect(separator).toBeGreaterThan(0);
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  });
}

/** frontmatter の後ろにある本文の行を取り出す。 */
function parseBodyLines(note: string): readonly string[] {
  const lines = note.split("\n");
  const end = lines.indexOf("---", 1);

  return lines
    .slice(end + 1)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function frontmatterValue(
  frontmatter: ReadonlyArray<[string, string]>,
  key: string,
): string {
  const entry = frontmatter.find(([name]) => name === key);
  expect(entry).toBeDefined();
  return entry?.[1] ?? "";
}

describe("buildFileName", () => {
  it("食べた時刻から YYYY-MM-DD-HHmm.md を返す", () => {
    expect(buildFileName(record)).toBe("2026-10-11-2100.md");

    // 日本時間の未明。日時を解釈すると UTC では前日の 19 時になり、
    // ファイル名の日付が 1 日ずれる。受け取った文字列をそのまま使えばずれない。
    expect(
      buildFileName({
        ...record,
        eatenAt: { date: "2026-10-12", time: "04:00" },
      }),
    ).toBe("2026-10-12-0400.md");
  });
});

describe("buildNote", () => {
  it("frontmatter に 8 項目を出力し、menu に量を入れ foods には入れない", () => {
    const frontmatter = parseFrontmatter(buildNote(record));

    expect(frontmatter.map(([key]) => key)).toEqual([
      "date",
      "time",
      "meal",
      "dish",
      "menu",
      "kcal",
      "protein",
      "foods",
    ]);
    expect(frontmatterValue(frontmatter, "date")).toBe("2026-10-11");
    expect(frontmatterValue(frontmatter, "time")).toBe("21:00");
    expect(frontmatterValue(frontmatter, "meal")).toBe("夜");
    expect(frontmatterValue(frontmatter, "dish")).toBe("鍋");

    // menu は読む用なので量が入る。foods は絞る用なので量を含まない。
    expect(frontmatterValue(frontmatter, "menu")).toBe(
      "白米300g / 鶏もも400g / ブロッコリー50g",
    );
    expect(frontmatterValue(frontmatter, "foods")).toBe(
      "[白米, 鶏もも, ブロッコリー]",
    );
    expect(frontmatterValue(frontmatter, "foods")).not.toMatch(/\d/);
  });

  it("本文に並べた数値の和が frontmatter の合計に等しい", () => {
    const note = buildNote(record);
    const frontmatter = parseFrontmatter(note);
    const bodyLines = parseBodyLines(note);

    expect(bodyLines).toHaveLength(items.length);

    // 期待値を目で書かず、本文から数値を取り出して実際に足す。
    // 丸めの扱いが変わったときに和の不一致として現れる。
    const totals = bodyLines.reduce(
      (sum, line) => {
        const matched = line.match(/^- .+ \d+g — (\d+) \/ P(\d+)$/);
        expect(matched).not.toBeNull();
        return {
          kcal: sum.kcal + Number(matched?.[1]),
          protein: sum.protein + Number(matched?.[2]),
        };
      },
      { kcal: 0, protein: 0 },
    );

    expect(String(totals.kcal)).toBe(frontmatterValue(frontmatter, "kcal"));
    expect(String(totals.protein)).toBe(
      frontmatterValue(frontmatter, "protein"),
    );

    // 丸めた値の和であることを押さえる。丸める前の値から出し直すと 86 になる。
    expect(totals).toEqual({ kcal: 938, protein: 87 });
  });

  it("料理名が無い記録でも dish の行を出し、値を空にする", () => {
    const frontmatter = parseFrontmatter(buildNote({ ...record, dish: null }));

    expect(frontmatter.map(([key]) => key)).toHaveLength(8);
    expect(frontmatter.map(([key]) => key)).toContain("dish");
    expect(frontmatterValue(frontmatter, "dish")).toBe("");

    // 空文字も値なしとして扱う。行末に空白が残らないことを行そのもので確かめる。
    expect(buildNote({ ...record, dish: "" })).toContain("\ndish:\n");
  });
});
