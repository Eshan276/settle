/**
 * Work that should finish after the response is sent (webhook delivery, chain syncs).
 * The standalone Node server just lets the promise run; on Vercel the Next.js route installs `after()`
 * so the function stays alive until the work is done.
 */
type Runner = (p: Promise<unknown>) => void;
let runner: Runner = (p) => void p;

export const setBackgroundRunner = (r: Runner) => {
  runner = r;
};

export function background(label: string, task: () => Promise<unknown>) {
  runner(task().catch((e) => console.error(`[settle] ${label} failed:`, (e as Error).message)));
}
