import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Short commit SHA, so the badge answers "is this the current build or a stale
// alias?". Vercel builds have no usable git checkout, hence the env var first;
// the git call is the local/packaged fallback and is guarded because there may
// be no repo at all.
function commitSha() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export — the Capacitor iOS shell packages the out/ directory.
  // The app is fully client-side (no API routes), so this is lossless.
  // Vercel auto-detects export output; the web deploy is unchanged.
  output: "export",
  images: { unoptimized: true },
  // Baked in at build time so the version survives the static export and the
  // packaged shells. See src/lib/version.ts.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_SHA: commitSha(),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
