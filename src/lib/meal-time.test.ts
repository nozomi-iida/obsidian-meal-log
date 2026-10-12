import { describe, expect, it } from "vitest";
import { estimateMealKind } from "./meal-time";
import type { MealKind } from "./types";

/**
 * ローカルタイムの時刻を組み立てる。
 *
 * 推定はローカルタイムで行うため、テストも UTC ではなくローカルタイムで
 * 時刻を作る。日付は境界の判定に関わらないので固定とする。
 */
function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 11, hour, minute);
}

// 設計書の時間帯の表の境界。各区分の終わりと次の区分の始まりを並べている。
// 境界の直前と境界そのものを対にすることで off-by-one を検出する。
const boundaries: ReadonlyArray<{
  readonly hour: number;
  readonly minute: number;
  readonly kind: MealKind;
}> = [
  { hour: 4, minute: 59, kind: "寝る前" },
  { hour: 5, minute: 0, kind: "朝" },
  { hour: 11, minute: 59, kind: "朝" },
  { hour: 12, minute: 0, kind: "昼" },
  { hour: 15, minute: 59, kind: "昼" },
  { hour: 16, minute: 0, kind: "間食" },
  { hour: 18, minute: 59, kind: "間食" },
  { hour: 19, minute: 0, kind: "夜" },
  { hour: 22, minute: 59, kind: "夜" },
  { hour: 23, minute: 0, kind: "寝る前" },
];

describe("estimateMealKind", () => {
  it.each(boundaries)(
    "$hour:$minute は $kind を返す",
    ({ hour, minute, kind }) => {
      expect(estimateMealKind(at(hour, minute))).toBe(kind);
    },
  );

  it("16 時台は間食を返す", () => {
    // 16 時ごろのシリアルが定着しているため、間食も推定の対象に含める
    expect(estimateMealKind(at(16, 30))).toBe("間食");
  });

  it("寝る前は日付をまたいでひとつの区分として扱う", () => {
    // 23:00–04:59 は 0 時で分かれない。23 時台と 0 時台が同じ区分になる
    expect(estimateMealKind(at(23, 30))).toBe("寝る前");
    expect(estimateMealKind(at(0, 0))).toBe("寝る前");
  });

  it("すべての時刻に対して値を返し、例外を投げない", () => {
    const kinds: readonly MealKind[] = ["朝", "昼", "夜", "間食", "寝る前"];

    for (let hour = 0; hour < 24; hour += 1) {
      for (const minute of [0, 30, 59]) {
        expect(kinds).toContain(estimateMealKind(at(hour, minute)));
      }
    }
  });
});
