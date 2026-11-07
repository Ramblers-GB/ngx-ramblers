import expect from "expect";
import { describe, it } from "mocha";
import { buildAdminIncidentHtml } from "./admin-alerts";

describe("buildAdminIncidentHtml", () => {
  it("matches the scheduled-task alert layout", () => {
    const html = buildAdminIncidentHtml({
      title: "Scheduled task failed",
      intro: "A scheduled task problem was detected on the platform admin environment.",
      items: [
        {label: "Task", value: "Walks Manager sync (walks-manager-sync)"},
        {label: "Problem", value: "failed"}
      ],
      message: "The scheduled task \"Walks Manager sync\" failed.",
      details: "timeout talking to Walks Manager",
      actionUrl: "https://group.example.org.uk/admin/settings/system-settings?tab=scheduled-tasks",
      actionLabel: "Open Scheduled Tasks",
      actionHint: "Admin → System Settings → Scheduled Tasks"
    });
    expect(html).toContain("Scheduled task failed");
    expect(html).toContain("Walks Manager sync (walks-manager-sync)");
    expect(html).toContain("timeout talking to Walks Manager");
    expect(html).toContain("Open Scheduled Tasks");
    expect(html).toContain("background:#c05711");
    expect(html).toContain("#dc2626");
    expect(html).toContain("Europe/London");
  });
});
