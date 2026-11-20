import expect from "expect";
import { describe, it } from "mocha";
import { combinedPlatformAdminColumns, platformAdminActionButtonsRow, platformAdminHref, platformAdminRows } from "./platform-admin-pages";

const button = (title: string, href: string) => ({title, href, accessLevel: "environmentAdmin", icon: "faServer"});

const legacyPlatform = {rows: [{type: "action-buttons", maxColumns: 2, columns: [
  button("Environment Management", "admin/platform/environment-management"),
  button("Cloudflare Workers", "admin/platform/cloudflare-workers")
]}]};

const legacyEnvironmentManagement = {rows: [{type: "action-buttons", maxColumns: 2, showSwiper: false, columns: [
  button("Environment Setup", "admin/platform/environment-management/setup"),
  button("Backup & Restore", "admin/platform/environment-management/backup"),
  button("AWS S3", "admin/platform/environment-management/aws")
]}]};

describe("platform admin pages", () => {
  it("moves old platform addresses to Platform Admin, keeping slashes, queries and anchors", () => {
    expect(platformAdminHref("admin/platform/environment-management/atlas")).toEqual("admin/platform-admin/atlas");
    expect(platformAdminHref("/admin/platform/environment-management/aws?tab=buckets")).toEqual("/admin/platform-admin/aws?tab=buckets");
    expect(platformAdminHref("admin/platform/environment-management")).toEqual("admin/platform-admin");
    expect(platformAdminHref("admin/platform")).toEqual("admin/platform-admin");
    expect(platformAdminHref("admin/platform/cloudflare-workers")).toEqual("admin/platform-admin/cloudflare-workers");
    expect(platformAdminHref("admin/settings")).toEqual("admin/settings");
    expect(platformAdminHref("admin/platform-admin/atlas")).toEqual("admin/platform-admin/atlas");
  });

  it("keeps the environment management order and puts Cloudflare Workers last", () => {
    const columns = combinedPlatformAdminColumns({platformAdmin: null, legacyPlatform, legacyEnvironmentManagement});
    expect(columns.map(column => column.title)).toEqual(["Environment Setup", "Backup & Restore", "AWS S3", "Cloudflare Workers"]);
    expect(columns.map(column => column.href)).toEqual([
      "admin/platform-admin/setup", "admin/platform-admin/backup", "admin/platform-admin/aws", "admin/platform-admin/cloudflare-workers"
    ]);
  });

  it("keeps the old page layout for the combined page", () => {
    const row = platformAdminActionButtonsRow({platformAdmin: null, legacyEnvironmentManagement}, []);
    expect(row).toEqual({type: "action-buttons", maxColumns: 2, showSwiper: false, columns: []});
  });

  it("changes nothing when run again on the combined page", () => {
    const columns = combinedPlatformAdminColumns({platformAdmin: null, legacyPlatform, legacyEnvironmentManagement});
    const platformAdmin = {rows: [platformAdminActionButtonsRow({platformAdmin: null, legacyEnvironmentManagement}, columns)]};
    expect(combinedPlatformAdminColumns({platformAdmin, legacyPlatform: null, legacyEnvironmentManagement: null})).toEqual(columns);
  });

  it("renames the admin page button and repoints it", () => {
    const rows = platformAdminRows([{type: "action-buttons", columns: [button("Platform Administration", "admin/platform"), button("Inbox", "admin/inbox")]}]);
    expect(rows[0].columns.map((column: { title: string; href: string }) => `${column.title} -> ${column.href}`)).toEqual([
      "Platform Admin -> admin/platform-admin",
      "Inbox -> admin/inbox"
    ]);
  });
});
