import { createHash, timingSafeEqual } from "node:crypto";

const SCHEME = "Basic ";

/** 期待する認証情報。実行環境から読み出した値をそのまま保持する。 */
export type Credentials = {
  readonly user: string;
  readonly password: string;
};

/**
 * 環境変数から認証情報を読み出す。両方が揃っていなければ null。
 *
 * 片方だけの設定は「未設定」として扱う。中途半端な状態で認証が有効になり、
 * 意図しない値で締め出されるのを避けるため。
 */
export function loadCredentials(
  env: Record<string, string | undefined>,
): Credentials | null {
  const user = env.BASIC_AUTH_USER;
  const password = env.BASIC_AUTH_PASSWORD;
  if (!user || !password) {
    return null;
  }
  return { user, password };
}

/**
 * 定数時間で 2 つの文字列を比較する。
 *
 * timingSafeEqual は長さの異なるバッファを渡すと例外を投げ、かつ長さの差
 * そのものが情報になる。先に固定長へハッシュ化することで両方を避ける。
 */
function equalsInConstantTime(a: string, b: string): boolean {
  const hashedA = createHash("sha256").update(a).digest();
  const hashedB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashedA, hashedB);
}

/**
 * Authorization ヘッダの値を検証する。
 *
 * 例外は投げない。ヘッダが無い、スキームが違う、復号できない、区切りが無い、
 * 値が一致しない — いずれも偽に集約する。失敗の理由を呼び出し側から
 * 区別できないようにするため。
 *
 * @param header `Basic <base64>` 形式の文字列。ヘッダが無い場合は null を渡す
 */
export function verifyCredentials(
  header: string | null,
  expected: Credentials,
): boolean {
  if (!header?.startsWith(SCHEME)) {
    return false;
  }

  const decoded = Buffer.from(header.slice(SCHEME.length), "base64").toString(
    "utf8",
  );
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  // 短絡評価にすると、利用者名が違う場合にパスワードの比較が省かれ、
  // 応答時間の差から利用者名の当否が漏れる。両方を必ず評価する。
  const userMatches = equalsInConstantTime(user, expected.user);
  const passwordMatches = equalsInConstantTime(password, expected.password);
  return userMatches && passwordMatches;
}
