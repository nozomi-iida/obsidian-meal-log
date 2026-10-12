/** 利用者が入力した食材。100g あたりの概算値も量も入力値である。 */
export type FoodInput = {
  readonly name: string;
  readonly kcalPer100g: number;
  readonly proteinPer100g: number;
  readonly grams: number;
};

/**
 * 食材 1 件の推定の結果。
 *
 * **推定できなかったことを `kcalPer100g` と `proteinPer100g` の欠落で表す。**
 * 0 で埋めない。0 kcal の食品（水、お茶）と区別がつかなくなり、タンパク質の
 * 集計が静かに狂う。
 */
export type FoodEstimate =
  | {
      readonly name: string;
      readonly ok: true;
      readonly kcalPer100g: number;
      readonly proteinPer100g: number;
    }
  | {
      readonly name: string;
      readonly ok: false;
      /** なぜ推定できなかったか。利用者に示す。 */
      readonly note: string;
    };

/** 記録の対象に加えた食材。量が決まり、栄養価は整数に丸められている。 */
export type MealItem = {
  readonly name: string;
  readonly grams: number;
  readonly kcal: number;
  readonly protein: number;
};

/**
 * 食事区分。
 *
 * 文字列リテラルの合併にするのは、vault に書く値がそのまま Obsidian の
 * 絞り込みに使われるためである。表記を型で固定する。
 */
export type MealKind = "朝" | "昼" | "夜" | "間食" | "寝る前";

/**
 * 食べた日時。**タイムゾーンを持たない。**
 *
 * `<input type="datetime-local">` の値をそのまま分解して保持する。実行環境の
 * タイムゾーンに依存しないため、サーバーがどこで動いても同じ値が vault に書かれる。
 */
export type LocalDateTime = {
  /** `YYYY-MM-DD` 形式の日付。 */
  readonly date: string;
  /** `HH:mm` 形式の時刻。 */
  readonly time: string;
};

/** 記録 1 件の内容。 */
export type MealRecord = {
  readonly eatenAt: LocalDateTime;
  readonly kind: MealKind;
  readonly dish: string | null;
  readonly items: readonly MealItem[];
};
