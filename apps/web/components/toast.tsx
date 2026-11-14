"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error"; title: string; body?: string; href?: string };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), t.kind === "error" ? 9000 : 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="fade-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border bg-[var(--popover)]/95 p-3 shadow-[0_20px_60px_-20px_rgb(40_90_255/0.5)] backdrop-blur">
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 break-words text-muted-foreground">{t.body}</p>}
              {t.href && (
                <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  View transaction
                </a>
              )}
            </div>
            <button onClick={() => setToasts((s) => s.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="-m-1.5 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
