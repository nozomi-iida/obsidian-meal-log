import type { MealKind } from "./types";

/**
 * 時刻から食事区分を推定する。
 *
 * 区切りは利用者の食事の時間から引いてある。普段の 5 食がいずれも
 * 手直し不要になるように配置した。16 時ごろのシリアルが定着しているため、
 * 間食も推定の対象に含める。
 *
 * 時刻だけを見る。利用者が自ら選んだ区分を優先する判断は記録フォームが持つ。
 *
 * 判定はローカルタイムで行う。vault は日本時間の生活記録であり、
 * UTC の時刻で判定すると区分がずれる。
 *
 * すべての時刻に対して値を返し、例外は投げない。
 */
export function estimateMealKind(eatenAt: Date): MealKind {
  const hour = eatenAt.getHours();

  // 寝る前は 23:00–04:59 で日付をまたぐ。0 時を挟んでひとつの区分として扱うため、
  // 判定を時間帯の前半（0:00–4:59）と後半（23:00–23:59）に分けて書く。
  if (hour < 5) {
    return "寝る前";
  }
  if (hour < 12) {
    return "朝";
  }
  if (hour < 16) {
    return "昼";
  }
  if (hour < 19) {
    return "間食";
  }
  if (hour < 23) {
    return "夜";
  }
  return "寝る前";
}
