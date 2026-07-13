import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.alistair.todoflow",
  appName: "TodoFlow",
  webDir: "out",
  backgroundColor: "#F7F6F3",
  ios: {
    contentInset: "automatic",
  },
};

// Live-reload dev workflow: point the native shell at `next dev` instead of
// the bundled out/ directory, e.g.
//   CAP_SERVER_URL=http://<mac-ip>:3000 npx cap sync ios
// then run from Xcode. Unset for release builds.
if (process.env.CAP_SERVER_URL) {
  config.server = { url: process.env.CAP_SERVER_URL, cleartext: true };
}

export default config;
