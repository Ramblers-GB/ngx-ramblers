import { describe, expect, it, vi } from "vitest";
import { EnvironmentAtlasComponent } from "./environment-atlas";
import {
  AtlasClusterRow,
  AtlasGhostDatabase,
  cleanupNeedsTypedConfirmation,
  cleanupSelectionSummary,
  ghostCleanupItem,
  loginsCleanupItem
} from "../../../models/atlas-cluster.model";

const ghost = {migrationId: "m1", environment: "staging", cluster: "group-registrations", database: "ngx-ramblers-staging", oldUsername: "old", movedTo: "shared", movedAt: null, collections: 78} as AtlasGhostDatabase;
const row = {
  name: "group-registrations",
  host: "group-registrations",
  ghostDatabases: [ghost],
  leftoverLogins: [
    {projectId: "p1", username: "staging-old", environment: "staging", database: "ngx-ramblers-staging", cluster: "group-registrations"},
    {projectId: "p1", username: "hike-essex-1", environment: "hike-essex", database: null, cluster: "group-registrations"},
    {projectId: "p1", username: "hike-essex-2", environment: "hike-essex", database: null, cluster: "group-registrations"}
  ]
} as AtlasClusterRow;
const loginsItem = loginsCleanupItem(row, {environment: "hike-essex", logins: row.leftoverLogins.slice(1)});

describe("Atlas clean-up selection", () => {
  it("describes what will be deleted and asks for typed confirmation only when a database is included", () => {
    const databaseItem = ghostCleanupItem(row, ghost);
    expect(databaseItem.logins.map(login => login.username)).toEqual(["staging-old"]);
    expect(cleanupSelectionSummary([databaseItem, loginsItem])).toBe("1 database and 2 unused logins");
    expect(cleanupNeedsTypedConfirmation([loginsItem])).toBe(false);
    expect(cleanupNeedsTypedConfirmation([databaseItem, loginsItem])).toBe(true);
  });

  it("deletes everything selected in turn, carries on past a failure, and refreshes the cluster inventory once", async () => {
    const environmentSetupService = {
      deleteGhostDatabase: vi.fn().mockResolvedValue({message: "Database deleted."}),
      deleteLeftoverLogin: vi.fn()
        .mockRejectedValueOnce({message: "Atlas refused"})
        .mockResolvedValueOnce({message: "Login deleted."})
    };
    const notify = {success: vi.fn(), error: vi.fn()};
    const instance = Object.create(EnvironmentAtlasComponent.prototype) as EnvironmentAtlasComponent;
    const load = vi.fn().mockResolvedValue(undefined);
    Object.assign(instance, {environmentSetupService, notify, load, host: {nativeElement: document.createElement("div")}, cleanupSelection: [], cleanupConfirmation: ""});
    instance.toggleCleanup(ghostCleanupItem(row, ghost));
    instance.toggleCleanup(loginsItem);
    expect(instance.cleanupConfirmed()).toBe(false);
    instance.cleanupConfirmation = "Delete";
    expect(instance.cleanupConfirmed()).toBe(true);
    await instance.runCleanup();
    expect(environmentSetupService.deleteGhostDatabase).toHaveBeenCalledWith({migrationId: "m1", confirmDatabase: "ngx-ramblers-staging"});
    expect(environmentSetupService.deleteLeftoverLogin).toHaveBeenCalledTimes(2);
    expect(notify.success).toHaveBeenCalledWith(expect.objectContaining({title: "Deleted 1 database"}));
    expect(notify.error).toHaveBeenCalledWith(expect.objectContaining({title: "Could not delete 2 unused logins"}));
    expect(load).toHaveBeenCalledTimes(1);
    expect(instance.cleanupSelection).toEqual([]);
  });

  it("removes a pill from the selection when its bin is clicked again", () => {
    const instance = Object.create(EnvironmentAtlasComponent.prototype) as EnvironmentAtlasComponent;
    Object.assign(instance, {host: {nativeElement: document.createElement("div")}, cleanupSelection: []});
    instance.toggleCleanup(loginsItem);
    instance.toggleCleanup(loginsCleanupItem(row, {environment: "hike-essex", logins: row.leftoverLogins.slice(1)}));
    expect(instance.cleanupSelection).toEqual([]);
  });
});
