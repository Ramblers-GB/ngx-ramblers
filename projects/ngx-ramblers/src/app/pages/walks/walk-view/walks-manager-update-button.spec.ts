import { EventEmitter } from "@angular/core";
import { WalksManagerUpdateButton } from "./walks-manager-update-button";
import { ExtendedGroupEvent, InputSource } from "../../../models/group-event.model";
import { EventPopulation, SystemConfig } from "../../../models/system.model";
import { RamblersEventType } from "../../../models/ramblers-walks-manager.model";
import { WalksManagerUpdateResponse } from "../../../models/walks-manager-update.model";

describe("Walks Manager update button", () => {
  function component(): WalksManagerUpdateButton {
    const button = Object.create(WalksManagerUpdateButton.prototype) as WalksManagerUpdateButton;
    button["currentWalk"] = {id: "walk-one", fields: {inputSource: InputSource.WALKS_MANAGER_CACHE}, groupEvent: {id: "100000001", item_type: RamblersEventType.GROUP_WALK, group_code: "HS01"}} as ExtendedGroupEvent;
    button["comparisonRequest"] = 0;
    button.updating = false;
    button.updateAvailable = false;
    button["memberLoginService"] = {memberLoggedIn: () => true, isAdmin: () => true} as unknown as typeof button["memberLoginService"];
    button["systemConfigService"] = {systemConfig: () => ({group: {walkPopulation: EventPopulation.WALKS_MANAGER, groupCode: "HS01"}} as SystemConfig)} as typeof button["systemConfigService"];
    button["ramblersService"] = {checkWalksManagerUpdate: vi.fn().mockResolvedValue({changed: true}), updateFromWalksManager: vi.fn()} as unknown as typeof button["ramblersService"];
    button["logger"] = {warn: vi.fn(), error: vi.fn()} as unknown as typeof button["logger"];
    button.notify = {success: vi.fn(), error: vi.fn()} as unknown as typeof button.notify;
    button.walkUpdated = new EventEmitter<ExtendedGroupEvent>();
    return button;
  }

  it("checks for changes without updating the saved walk", async () => {
    const button = component();
    await button.checkForUpdate();
    expect(button.updateAvailable).toBe(true);
    expect(button["ramblersService"].updateFromWalksManager).not.toHaveBeenCalled();
  });

  it("hides the action when Walks Manager reports no difference", async () => {
    const button = component();
    vi.mocked(button["ramblersService"].checkWalksManagerUpdate).mockResolvedValue({changed: false, walk: null});
    await button.checkForUpdate();
    expect(button.updateAvailable).toBe(false);
  });

  it("excludes local-source sites, locally created walks and non-admins", async () => {
    const button = component();
    button["systemConfigService"] = {systemConfig: () => ({group: {walkPopulation: EventPopulation.LOCAL}} as SystemConfig)} as typeof button["systemConfigService"];
    await button.checkForUpdate();
    expect(button.eligible()).toBe(false);
    expect(button["ramblersService"].checkWalksManagerUpdate).not.toHaveBeenCalled();
    const local = component();
    local["currentWalk"].fields.inputSource = InputSource.MANUALLY_CREATED;
    expect(local.eligible()).toBe(false);
    const member = component();
    member["memberLoginService"] = {memberLoggedIn: () => true, isAdmin: () => false} as unknown as typeof member["memberLoginService"];
    expect(member.eligible()).toBe(false);
  });

  it("ignores a comparison that finishes after changing walks", async () => {
    const button = component();
    const pending: ((response: WalksManagerUpdateResponse) => void)[] = [];
    vi.mocked(button["ramblersService"].checkWalksManagerUpdate).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const first = button.checkForUpdate();
    button["currentWalk"] = {...button["currentWalk"], id: "walk-two"};
    const second = button.checkForUpdate();
    pending[1]({changed: false, walk: null});
    await second;
    pending[0]({changed: true, walk: null});
    await first;
    expect(button.updateAvailable).toBe(false);
  });

  it("applies the refreshed walk and prevents duplicate updates", async () => {
    const button = component();
    const updated = {...button["currentWalk"], groupEvent: {...button["currentWalk"].groupEvent, title: "Hillside Park"}};
    button.updateAvailable = true;
    const pending: ((response: WalksManagerUpdateResponse) => void)[] = [];
    vi.mocked(button["ramblersService"].updateFromWalksManager).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const emit = vi.spyOn(button.walkUpdated, "emit");
    const first = button.updateWalk();
    await button.updateWalk();
    expect(button["ramblersService"].updateFromWalksManager).toHaveBeenCalledOnce();
    pending[0]({changed: true, walk: updated});
    await first;
    expect(emit).toHaveBeenCalledWith(updated);
    expect(button.updateAvailable).toBe(false);
    expect(button.updating).toBe(false);
  });

  it("keeps the update available for retry after a failed request", async () => {
    const button = component();
    button.updateAvailable = true;
    vi.mocked(button["ramblersService"].updateFromWalksManager).mockRejectedValue(new Error("Connection failed"));
    await button.updateWalk();
    expect(button.notify.error).toHaveBeenCalled();
    expect(button.updating).toBe(false);
    expect(button.updateAvailable).toBe(true);
  });
});
