// The only bridge between the renderer and the desktop shell. Deliberately
// tiny: publish timer state out, receive tray commands in. Nothing else is
// exposed, and contextIsolation stays on.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("todoflow", {
  isDesktop: true,

  /**
   * Push the current timer state to the menu bar. Called on state *changes*,
   * not every second — the main process does the ticking.
   */
  publishTimer(state) {
    ipcRenderer.send("todoflow:timer", state);
  },

  /**
   * Write today's plan + actuals to disk for /world-sync to mirror into World
   * HQ. Debounced by the caller; overwrites the day's file each time.
   */
  publishDaySnapshot(snapshot) {
    ipcRenderer.send("todoflow:day-snapshot", snapshot);
  },

  /**
   * Subscribe to tray menu commands ("pause" | "resume" | "done" | "extend5" |
   * "start"). Returns an unsubscribe function.
   */
  onCommand(handler) {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on("todoflow:command", listener);
    return () => ipcRenderer.removeListener("todoflow:command", listener);
  },
});
