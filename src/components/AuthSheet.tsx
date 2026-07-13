"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/src/lib/supabase";

// Email OTP sign-in (6-digit code). Deliberately not magic-link: the code
// flow is identical on the Vercel web app and inside the Capacitor WKWebView
// — no redirect URLs, no deep links, works when the email is opened on a
// different device.
export function AuthSheet(props: {
  open: boolean;
  user: User | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;
  const sb = getSupabase();
  if (!sb) return null;

  async function sendCode() {
    if (!sb || busy) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("code");
  }

  async function verifyCode() {
    if (!sb || busy) return;
    const token = code.trim();
    if (token.length < 6) return;
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("email");
    setCode("");
    props.onClose();
  }

  async function signOut() {
    if (!sb || busy) return;
    setBusy(true);
    await sb.auth.signOut({ scope: "local" });
    setBusy(false);
    props.onClose();
  }

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label="Account and sync"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-[420px] rounded-t-2xl sm:rounded-2xl border border-line bg-white p-6 shadow-soft pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-muted">Sync</div>
            <div className="mt-1 text-lg text-ink">
              {props.user ? "Signed in" : "Sign in to sync across devices"}
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink hover:bg-soft transition-colors"
          >
            Close
          </button>
        </div>

        {props.user ? (
          <div className="mt-4 space-y-4">
            <div className="text-sm text-muted">
              {props.user.email} — your tasks sync to this account.
            </div>
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-soft transition-colors"
            >
              Sign out on this device
            </button>
          </div>
        ) : step === "email" ? (
          <div className="mt-4 space-y-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendCode();
              }}
              placeholder="you@example.com"
              aria-label="Email address"
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy || !email.trim()}
              className={[
                "w-full rounded-lg px-4 py-2.5 text-sm transition-colors",
                busy || !email.trim()
                  ? "border border-line bg-white/40 text-muted cursor-not-allowed"
                  : "border border-line bg-ink text-paper hover:bg-black",
              ].join(" ")}
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="text-sm text-muted">
              Enter the 6-digit code sent to {email.trim()}.
            </div>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void verifyCode();
              }}
              placeholder="123456"
              aria-label="One-time code"
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-center text-lg tracking-[0.4em] tabular-nums outline-none focus:ring-2 focus:ring-[rgba(20,20,20,0.10)]"
            />
            <button
              type="button"
              onClick={() => void verifyCode()}
              disabled={busy || code.trim().length < 6}
              className={[
                "w-full rounded-lg px-4 py-2.5 text-sm transition-colors",
                busy || code.trim().length < 6
                  ? "border border-line bg-white/40 text-muted cursor-not-allowed"
                  : "border border-line bg-ink text-paper hover:bg-black",
              ].join(" ")}
            >
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              className="text-xs text-muted hover:text-ink transition-colors"
            >
              ← Different email
            </button>
          </div>
        )}

        {error ? <div className="mt-3 text-sm text-rose-700">{error}</div> : null}
      </div>
    </div>
  );
}
