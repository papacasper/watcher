/**
 * SystemNotifier - Manjaro notify-send wrapper
 */
export class SystemNotifier {
  private iconPath: string;
  private appName: string;

  constructor(
    iconPath = "dialog-information",
    appName = "Whale Watcher"
  ) {
    this.iconPath = iconPath;
    this.appName = appName;
  }

  /**
   * Send a desktop notification via notify-send (Manjaro/Linux native)
   */
  notify(title: string, body: string, urgency: "low" | "normal" | "critical" = "normal"): void {
    const proc = Bun.spawn([
      "notify-send",
      "-a", this.appName,
      "-u", urgency,
      "-i", this.iconPath,
      title,
      body,
    ], {
      stdout: "ignore",
      stderr: "ignore",
    });

    proc.exited.then(exitCode => {
      if (exitCode !== 0) {
        console.warn(`[Notifier] notify-send failed with exit code ${exitCode}`);
      }
    }).catch(e => {
      console.warn("[Notifier] notify-send failed:", e instanceof Error ? e.message : e);
    });
  }

  /**
   * Send a critical alert (bypasses Do Not Disturb)
   */
  critical(title: string, body: string): void {
    this.notify(title, body, "critical");
  }
}

export default SystemNotifier;
