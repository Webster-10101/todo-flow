// Build stamps, baked in by next.config.mjs at build time. They're plain
// strings rather than a package.json import so the values survive the static
// export and the packaged shells (which have no repo and no git).
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA || "—";
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE || "";

// Key for the last version whose changelog was read. Drives the "new" dot.
export const LAST_SEEN_VERSION_KEY = "todoflow:lastSeenVersion";
