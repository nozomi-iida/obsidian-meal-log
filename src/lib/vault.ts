import { Buffer } from "node:buffer";

/**
 * vault の中の食事ログの保存先。
 *
 * 場所は product.md が確定しているので定数にする。環境変数にすると
 * 配置環境ごとに保存先が変わりうる状態になり、Obsidian 側の一覧と齟齬が出る。
 */
const ITEMS_PATH = "Meals/items";

const API_ORIGIN = "https://api.github.com";

/** vault の所在と資格情報。 */
export type VaultConfig = {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
};

/** 書き込みの結果。失敗の理由は利用者に示す 3 分類に対応する。 */
export type WriteResult =
  | { readonly ok: true; readonly fileName: string }
  | {
      readonly ok: false;
      readonly reason: "duplicate" | "permission" | "network";
    };

/**
 * 環境変数から vault の設定を読み出す。3 つが揃っていなければ null。
 *
 * 一部だけの設定は「未設定」として扱う。欠けた値のまま要求を組み立てると、
 * 存在しないリポジトリへの書き込みや資格情報なしの要求になり、
 * 設定の不足が権限エラーや通信エラーに化けて原因が分からなくなる。
 *
 * 引数で受け取るのは、要求ごとに読み出せるようにするため。モジュールの
 * 読み込み時に固定すると、設定を変えたときに再起動が必要になる。
 */
export function loadVaultConfig(
  env: Record<string, string | undefined>,
): VaultConfig | null {
  const owner = env.VAULT_OWNER;
  const repo = env.VAULT_REPO;
  const token = env.VAULT_TOKEN;
  if (!owner || !repo || !token) {
    return null;
  }
  return { owner, repo, token };
}

/**
 * vault にファイルを新規作成する。例外は投げない。
 *
 * `sha` を送らず、既存ファイルの取得も行わない。ファイル名が食べた時刻なので
 * 書き込みは常に新規作成であり、既存を読んで統合する余地がない。
 *
 * 失敗はステータスコードだけで分類する。応答本文の文面は見ない。文面は
 * GitHub の都合で変わりうるためである。
 * - 201 … 新規作成に成功した
 * - 422 … 同じ名前のファイルが既にある（`sha` の不足として返る。実測で確定）
 * - 401 / 403 … 資格情報が受け付けられない
 * - それ以外・通信失敗 … 到達できないか、応答が解釈できない
 *
 * 失敗しても応答の内容をログに出さない。要求のヘッダにトークンが含まれるため。
 */
export async function writeNote(
  config: VaultConfig,
  fileName: string,
  body: string,
): Promise<WriteResult> {
  const url = `${API_ORIGIN}/repos/${config.owner}/${config.repo}/contents/${ITEMS_PATH}/${fileName}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `食事記録を追加: ${fileName}`,
        content: Buffer.from(body, "utf8").toString("base64"),
      }),
    });
  } catch {
    // 到達できなかった場合。理由は呼び出し側に渡さない。
    return { ok: false, reason: "network" };
  }

  if (response.status === 201) {
    return { ok: true, fileName };
  }
  if (response.status === 422) {
    return { ok: false, reason: "duplicate" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "permission" };
  }
  return { ok: false, reason: "network" };
}
