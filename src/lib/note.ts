import { sumNutrition } from "./nutrition";
import type { MealItem, MealRecord } from "./types";

/**
 * 記録からファイル名を決める。拡張子を含む。
 *
 * 受け取った日付と時刻の文字列をそのまま組み立てる。`Date` を作って整形すると
 * サーバーの既定のタイムゾーン（Vercel では UTC）で日付がずれる。
 * 日本時間の 04:00 が前日の 19:00 になり、ファイル名の日付が 1 日ずれる。
 */
export function buildFileName(record: MealRecord): string {
  const { date, time } = record.eatenAt;

  // `HH:mm` から区切りを外して `HHmm` にする。時刻としては解釈しない。
  return `${date}-${time.replace(":", "")}.md`;
}

/**
 * 量つきのサマリーを組み立てる。
 *
 * 一覧で数字の根拠を読むための列なので、量を名前に続けて書く。
 */
function buildMenu(items: readonly MealItem[]): string {
  return items.map((item) => `${item.name}${item.grams}g`).join(" / ");
}

/**
 * 食材名のリストを組み立てる。
 *
 * 絞り込みと集計に使う列なので量を含めない。`menu` と用途が逆である。
 */
function buildFoods(items: readonly MealItem[]): string {
  return `[${items.map((item) => item.name).join(", ")}]`;
}

/**
 * 本文の内訳を組み立てる。
 *
 * 丸めた食材ごとの値をそのまま並べる。合計も同じ値から出すため、
 * 並べた数字を足せば frontmatter の合計になる。
 */
function buildBody(items: readonly MealItem[]): string {
  return items
    .map(
      (item) =>
        `- ${item.name} ${item.grams}g — ${item.kcal} / P${item.protein}`,
    )
    .join("\n");
}

/**
 * 記録から Markdown の全文を組み立てる。
 *
 * frontmatter は常に 8 項目を出力する。料理名が無い記録でも `dish` の行を出し、
 * 値だけを空にする。項目が常に揃っていれば、Obsidian 側で
 * 「プロパティが無いノート」を考慮せずに一覧を組める。
 *
 * 合計は `sumNutrition` に任せる。本文に並べる値と同じものを足すため、
 * 本文の和と frontmatter の合計が一致する。
 */
export function buildNote(record: MealRecord): string {
  const total = sumNutrition(record.items);

  // 並び順は Obsidian で読む順に合わせてある。
  const frontmatter = [
    `date: ${record.eatenAt.date}`,
    `time: ${record.eatenAt.time}`,
    `meal: ${record.kind}`,
    // 空文字でも値なしとして扱う。行末に空白を残さないため。
    record.dish ? `dish: ${record.dish}` : "dish:",
    `menu: ${buildMenu(record.items)}`,
    `kcal: ${total.kcal}`,
    `protein: ${total.protein}`,
    `foods: ${buildFoods(record.items)}`,
  ].join("\n");

  return `---\n${frontmatter}\n---\n\n${buildBody(record.items)}\n`;
}
