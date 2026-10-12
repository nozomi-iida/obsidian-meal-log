import { RecordForm } from "./record-form";

/**
 * この画面のサーバー側の処理に許す秒数。**実測で裏づけていない暫定値である。**
 *
 * Server Action は専用の上限を持たず、それが属するページの `maxDuration` に
 * 従う。栄養価の推定はこの画面から呼ばれるため、ここが推定の実質的な上限になる。
 *
 * 配置先の既定は 300 秒あるが、ハングした推定を 5 分待たせるより早く失敗させる。
 * `src/lib/estimate.ts` の `AbortSignal.timeout` が 30 秒なので、その 2 倍を
 * 取っている。推定側が自分で打ち切れなかった場合の受け皿として、推定の上限を
 * 下回らない値にしてある。
 */
export const maxDuration = 60;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <RecordForm />
    </main>
  );
}
