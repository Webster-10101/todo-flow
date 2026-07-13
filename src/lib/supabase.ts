"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Preferences } from "@capacitor/preferences";
import { isNative } from "./platform";

// WKWebView can evict localStorage under storage pressure; Capacitor
// Preferences persists in native storage, so the session survives.
const capacitorAuthStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key: string) => {
    await Preferences.remove({ key });
  },
};

let client: SupabaseClient | null | undefined;

// Null when the env vars aren't configured — the app then runs exactly as
// the original local-only build (no auth button, no sync).
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    client = null;
    return client;
  }
  client = createClient(url, anonKey, {
    auth: {
      storage: isNative() ? capacitorAuthStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      // OTP flow — no magic-link redirects to detect.
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function isSyncConfigured(): boolean {
  return getSupabase() !== null;
}
