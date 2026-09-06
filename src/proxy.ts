import type { NextRequest } from "next/server";
import { loadCredentials, verifyCredentials } from "@/lib/basic-auth";

const REALM = 'Basic realm="Meal Log", charset="UTF-8"';

/**
 * すべての要求を受ける関門。
 *
 * 認証の有効・無効は実行環境の種別ではなく、認証情報が設定されているかで決まる。
 * 手元でも設定すれば認証の挙動を確かめられる。
 *
 * 判定そのものは持たず、basic-auth に委譲する。
 */
export function proxy(request: NextRequest): Response | undefined {
  // 要求ごとに読み出す。起動時に固定すると、設定を変えた際に再起動が要るため。
  const credentials = loadCredentials(process.env);

  if (!credentials) {
    if (process.env.NODE_ENV === "production") {
      // 設定漏れのまま無防備に公開されるのを防ぐ。不足している変数名は示すが値は含めない。
      return new Response(
        "BASIC_AUTH_USER と BASIC_AUTH_PASSWORD が設定されていません。",
        { status: 500 },
      );
    }
    return undefined;
  }

  if (verifyCredentials(request.headers.get("authorization"), credentials)) {
    return undefined;
  }

  // ヘッダなし・形式不正・値の不一致をすべて同じ応答に集約する。
  // 理由を区別できると総当たりの手掛かりになる。リダイレクトはしない。
  return new Response(null, {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

export const config = {
  // 除外はマニフェストとアイコンの 2 つのみ。ブラウザはこれらの取得に認証情報を
  // 送らないため、遮断するとホーム画面に追加できない。受入基準 3.4 の但し書きに
  // 対応する。静的アセットは対象に含める。
  //
  // ピリオドは正規表現として解釈されるためエスケープする。素のままだと
  // /manifestXwebmanifest のような無関係なパスまで除外に落ちる。
  matcher: ["/((?!manifest\\.webmanifest|favicon\\.ico).*)"],
};
