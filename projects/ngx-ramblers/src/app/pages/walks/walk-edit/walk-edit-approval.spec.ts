import { WalkEditComponent } from "./walk-edit.component";
import { DisplayedWalk, EventType } from "../../../models/walk.model";
import { WalkEventType } from "../../../models/walk-event-type.model";
import { InputSource } from "../../../models/group-event.model";
import { ConfirmType } from "../../../models/ui-actions.model";

describe("walk approval permissions", () => {
  function component(admin: boolean, leader: boolean): WalkEditComponent {
    const view = Object.create(WalkEditComponent.prototype) as WalkEditComponent;
    view.confirmAction = ConfirmType.NONE;
    view.saveInProgress = false;
    view.displayedWalk = {
      status: EventType.AWAITING_WALK_DETAILS,
      walkAccessMode: {walkWritable: true},
      walk: {fields: {contactDetails: {memberId: "leader-one"}, publishing: {ramblers: {}}}}
    } as DisplayedWalk;
    view["memberLoginService"] = {allowWalkAdminEdits: () => admin} as typeof view["memberLoginService"];
    view["display"] = {
      allowAdminEdits: () => admin,
      loggedInMemberIsLeadingWalk: () => leader,
      members: [{id: "leader-one", displayName: "Alex Reed"}]
    } as unknown as typeof view["display"];
    view["urlService"] = {pathContains: () => false} as unknown as typeof view["urlService"];
    view["logger"] = {info: vi.fn()} as unknown as typeof view["logger"];
    view.notify = {hide: vi.fn()} as unknown as typeof view.notify;
    view["refreshRematchPreview"] = vi.fn();
    view["setStatus"] = vi.fn(status => view.displayedWalk.status = status);
    return view;
  }

  it("lets administrators submit or approve another leader's walk", () => {
    const view = component(true, false);
    expect(view.allowRequestApproval()).toBe(true);
    expect(view.allowApprove()).toBe(true);
  });

  it("lets leaders request approval without granting approval rights", () => {
    const view = component(false, true);
    expect(view.allowRequestApproval()).toBe(true);
    expect(view.allowApprove()).toBe(false);
    expect(component(false, false).allowRequestApproval()).toBe(false);
  });

  it("limits approval actions to editable walks and the relevant statuses", () => {
    const view = component(true, false);
    view.displayedWalk.status = EventType.AWAITING_APPROVAL;
    expect(view.allowApprove()).toBe(true);
    expect(view.allowRequestApproval()).toBe(false);
    view.displayedWalk.status = EventType.APPROVED;
    expect(view.allowApprove()).toBe(false);
    view.displayedWalk.status = EventType.AWAITING_WALK_DETAILS;
    view.displayedWalk.walkAccessMode.walkWritable = false;
    expect(view.allowApprove()).toBe(false);
    expect(view.allowRequestApproval()).toBe(false);
  });

  it("hides approval actions in view mode and during confirmation or saving", () => {
    const view = component(true, false);
    view["urlService"] = {pathContains: () => true} as unknown as typeof view["urlService"];
    expect(view.allowApprove()).toBe(false);
    expect(view.allowRequestApproval()).toBe(false);
    view["urlService"] = {pathContains: () => false} as unknown as typeof view["urlService"];
    view.confirmAction = ConfirmType.CANCEL;
    expect(view.allowApprove()).toBe(false);
    expect(view.allowRequestApproval()).toBe(false);
    view.confirmAction = ConfirmType.NONE;
    view.saveInProgress = true;
    expect(view.allowApprove()).toBe(false);
    expect(view.allowRequestApproval()).toBe(false);
  });

  it("keeps imported leader assignment approved", async () => {
    const view = component(true, false);
    view.displayedWalk.status = EventType.AWAITING_LEADER;
    view.displayedWalk.walk.fields.inputSource = InputSource.WALKS_MANAGER_CACHE;
    view.walkLeaderMemberIdChanged();
    await Promise.resolve();
    expect(view.displayedWalk.status).toBe(EventType.APPROVED);
  });

  it.each([EventType.AWAITING_APPROVAL, EventType.APPROVED, EventType.DELETED])("preserves %s when replacing the leader", async status => {
    const view = component(true, false);
    view.displayedWalk.status = status;
    view.walkLeaderMemberIdChanged();
    await Promise.resolve();
    expect(view.displayedWalk.status).toBe(status);
    expect(view["setStatus"]).not.toHaveBeenCalled();
  });

  it("advances a local unassigned slot to awaiting details", async () => {
    const view = component(true, false);
    view.displayedWalk.status = EventType.AWAITING_LEADER;
    view.walkLeaderMemberIdChanged();
    await Promise.resolve();
    expect(view.displayedWalk.status).toBe(EventType.AWAITING_WALK_DETAILS);
  });
});

describe("deleted walk status protection", () => {
  function deletedWalk(): WalkEditComponent {
    const view = Object.create(WalkEditComponent.prototype) as WalkEditComponent;
    view["persistedWalk"] = {id: "deleted-walk"} as typeof view["persistedWalk"];
    view["display"] = {statusFor: () => EventType.DELETED} as unknown as typeof view["display"];
    view["logger"] = {info: vi.fn()} as unknown as typeof view["logger"];
    view.notify = {hide: vi.fn(), warning: vi.fn()} as unknown as typeof view.notify;
    view.displayedWalk = {status: EventType.DELETED} as DisplayedWalk;
    view.validateWalk = vi.fn().mockReturnValue({validationMessages: []});
    view["walksReferenceService"] = {toWalkEventType: (status: EventType) => ({eventType: status})} as unknown as typeof view["walksReferenceService"];
    return view;
  }

  it("refuses to change a persisted deleted walk to an active status", () => {
    const view = deletedWalk();
    view.setStatus(EventType.AWAITING_LEADER);
    expect(view.displayedWalk.status).toBe(EventType.DELETED);
    expect(view.isWalkReadyForStatusChangeTo({eventType: EventType.AWAITING_LEADER} as WalkEventType)).toBe(false);
    expect(view.notify.warning).toHaveBeenCalledWith(expect.objectContaining({title: "Deleted walks cannot be restored"}));
  });

  it("still allows saving a deleted status", () => {
    const view = deletedWalk();
    expect(view.isWalkReadyForStatusChangeTo({eventType: EventType.DELETED} as WalkEventType)).toBe(true);
  });

  it("leaves the status select unchanged when a deleted walk's selection is rejected", () => {
    const view = deletedWalk();
    view.onWalkStatusChange(EventType.AWAITING_LEADER);
    expect(view.displayedWalk.status).toBe(EventType.DELETED);
    expect(view.notify.warning).toHaveBeenCalledWith(expect.objectContaining({title: "Deleted walks cannot be restored"}));
  });
});
