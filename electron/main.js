// TodoFlow desktop shell.
//
// Plain CommonJS on purpose: the main process needs no build step this way, so
// there's one less thing between an edit and a running app. The renderer is the
// same Next static export that ships to web and iOS.
//
// Two rules this file lives by (see CLAUDE.md):
//   1. It renders, it doesn't decide. The renderer owns the timer state machine
//      and tells us when a task ends; we only count down to that timestamp.
//   2. The window is served over a custom app:// protocol, never localhost.
//      localStorage is scoped per origin *including port*, so a dev-server port
//      that shifted between launches would silently wipe the user's tasks.

const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  protocol,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Pin the app name before anything reads getPath("userData"). Unpinned, dev
// runs would use package.json's "todoflow" and the packaged app "TodoFlow" —
// two different data directories on a case-sensitive volume, and two different
// places for /world-sync to look for the day snapshot.
app.setName("TodoFlow");

const OUT_DIR = path.join(__dirname, "..", "out");
// Set by `npm run desktop:dev` to point at the Next dev server instead.
const DEV_URL = process.env.TODOFLOW_DEV_URL || "";
const APP_ORIGIN = "app://todoflow";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
};

/**
 * Latest timer snapshot from the renderer. `endMs` is the only clock we trust —
 * we never derive task durations here.
 * @type {{running: boolean, title: string, endMs: number|null, paused: boolean,
 *         remainingMs: number|null, nextTitle: string|null, canStart: boolean}}
 */
let timer = {
  running: false,
  title: "",
  endMs: null,
  paused: false,
  remainingMs: null,
  nextTitle: null,
  canStart: false,
};

let win = null;
let tray = null;
let tickHandle = null;
let isQuitting = false;
// Guards against re-firing the time's-up notification every tick.
let notifiedForEndMs = null;

// A privileged scheme so the renderer gets a real secure origin: localStorage,
// fetch and the rest behave exactly as they do on the web build.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "" || rel === "/") rel = "/index.html";

    const filePath = path.normalize(path.join(OUT_DIR, rel));
    // Directory traversal guard — the URL is attacker-influenced in principle.
    if (!filePath.startsWith(OUT_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        headers: {
          "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        },
      });
    } catch {
      // Unknown path → hand back the single-page entry, same as a static host.
      try {
        const fallback = await fs.promises.readFile(path.join(OUT_DIR, "index.html"));
        return new Response(fallback, { headers: { "content-type": "text/html" } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 380,
    minHeight: 520,
    title: "TodoFlow",
    backgroundColor: "#F7F6F3",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(DEV_URL || `${APP_ORIGIN}/index.html`);

  // A blank window is the classic symptom of the protocol handler missing an
  // asset path — say so out loud rather than leaving it to guesswork.
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[todoflow] failed to load ${url}: ${desc} (${code})`);
  });
  win.webContents.on("did-finish-load", () => {
    console.log(`[todoflow] loaded ${win.webContents.getURL()}`);
    // Smoke check for `npm run desktop:verify`: prove the app actually mounted
    // rather than serving a bare HTML shell with 404'd chunks, then exit.
    // TODOFLOW_VERIFY=1 runs the default probe; any other value is evaluated as
    // an expression in the renderer, which makes one-off UI checks cheap.
    const verify = process.env.TODOFLOW_VERIFY;
    if (verify) {
      const expression =
        verify === "1" ? "document.querySelectorAll('button').length + ' buttons'" : verify;
      win.webContents
        .executeJavaScript(expression)
        .then((result) => console.log(`[todoflow] verify: ${result}`))
        .catch((err) => console.error(`[todoflow] verify failed: ${err.message}`))
        .finally(() => {
          isQuitting = true;
          app.quit();
        });
    }
  });

  // Renderer errors would otherwise vanish silently in a packaged app.
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`);
  });

  // Closing the window parks the app in the menu bar rather than quitting —
  // the whole point of the tray is that the countdown outlives the window.
  win.on("close", (e) => {
    if (isQuitting) return;
    e.preventDefault();
    win.hide();
  });

  // External links open in the real browser, not inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatCountdown(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Menu bar items compete with everything else up there, so the task title is
// clipped hard. Long enough to tell two tasks apart, short enough not to shove
// the clock off a laptop screen.
const TRAY_TITLE_MAX = 22;

// What the menu bar reads: "⏱ Silversea voyages · 24:31". Title first (it's the
// context), countdown last (it's the bit that changes).
function trayTitle() {
  if (!timer.running) return "⏱";

  const label = truncate(timer.title, TRAY_TITLE_MAX);
  const prefix = timer.paused ? "⏸" : "⏱";

  let time;
  if (timer.paused) {
    time = formatCountdown(timer.remainingMs ?? 0);
  } else if (timer.endMs == null) {
    return label ? `${prefix} ${label}` : prefix;
  } else {
    const remaining = timer.endMs - Date.now();
    time = remaining <= 0 ? "done" : formatCountdown(remaining);
  }

  return label ? `${prefix} ${label} · ${time}` : `${prefix} ${time}`;
}

function send(command) {
  if (win && !win.isDestroyed()) win.webContents.send("todoflow:command", command);
}

function buildTrayMenu() {
  const items = [];

  if (timer.running) {
    items.push({ label: truncate(timer.title || "Untitled task", 40), enabled: false });
    items.push({ type: "separator" });
    items.push({
      label: timer.paused ? "Resume" : "Pause",
      click: () => send(timer.paused ? "resume" : "pause"),
    });
    items.push({ label: "Done", click: () => send("done") });
    items.push({ label: "+5 minutes", click: () => send("extend5") });
  } else {
    items.push({
      label: timer.canStart ? "Start next task" : "Nothing queued",
      enabled: timer.canStart,
      click: () => send("start"),
    });
  }

  if (timer.nextTitle) {
    items.push({ type: "separator" });
    items.push({ label: `Next up: ${truncate(timer.nextTitle, 34)}`, enabled: false });
  }

  items.push({ type: "separator" });
  items.push({ label: "Open TodoFlow", click: showWindow });
  items.push({
    label: "Quit TodoFlow",
    accelerator: "Command+Q",
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });

  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  const title = trayTitle();
  tray.setTitle(title);
  tray.setContextMenu(buildTrayMenu());
  if (process.env.TODOFLOW_VERIFY) console.log(`[todoflow] tray: "${title}"`);
}

function createTray() {
  // Text-only menu bar item: an empty image plus setTitle. Avoids shipping an
  // icon asset for something that's read as text anyway.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("TodoFlow");
  refreshTray();

  // The tick lives here, not in the renderer: a hidden window gets its timers
  // throttled by Chromium, which would make the menu bar drift or freeze.
  tickHandle = setInterval(() => {
    if (!tray) return;
    tray.setTitle(trayTitle());
    maybeNotifyTimeUp();
  }, 1000);
}

function maybeNotifyTimeUp() {
  if (!timer.running || timer.paused || timer.endMs == null) return;
  if (Date.now() < timer.endMs) return;
  if (notifiedForEndMs === timer.endMs) return;
  notifiedForEndMs = timer.endMs;

  if (Notification.isSupported()) {
    const n = new Notification({
      title: "TodoFlow — time's up",
      body: timer.title || "Task time is up",
    });
    n.on("click", showWindow);
    n.show();
  }
}

// Day snapshot → disk, for /world-sync to pick up on its next run. World HQ's
// architecture is "an agent on the Mac writes what the web renders", so the
// desktop app just leaves a file where the sync can find it. No network, no
// credentials here.
function daySnapshotPath(date) {
  return path.join(app.getPath("userData"), "days", `day-${date}.json`);
}

ipcMain.on("todoflow:day-snapshot", async (_event, snapshot) => {
  if (!snapshot || typeof snapshot.date !== "string") return;
  try {
    const file = daySnapshotPath(snapshot.date);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error(`[todoflow] day snapshot write failed: ${err.message}`);
  }
});

ipcMain.on("todoflow:timer", (_event, next) => {
  if (!next || typeof next !== "object") return;
  timer = {
    running: Boolean(next.running),
    title: typeof next.title === "string" ? next.title : "",
    endMs: typeof next.endMs === "number" ? next.endMs : null,
    paused: Boolean(next.paused),
    remainingMs: typeof next.remainingMs === "number" ? next.remainingMs : null,
    nextTitle: typeof next.nextTitle === "string" ? next.nextTitle : null,
    canStart: Boolean(next.canStart),
  };
  // A new end time is a new deadline to announce.
  if (notifiedForEndMs !== timer.endMs) notifiedForEndMs = null;
  refreshTray();
});

// Single instance: a second launch focuses the running app instead of starting
// a rival copy with its own tray and its own idea of the time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    if (!DEV_URL) registerAppProtocol();
    createWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

// Closing every window is not quitting — the tray keeps running. This overrides
// the usual non-macOS behaviour deliberately; it's the same on every platform.
app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  isQuitting = true;
  if (tickHandle) clearInterval(tickHandle);
});
