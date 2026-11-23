import { EventEmitter } from "@angular/core";
import { NgModel } from "@angular/forms";
import { DisplayedWalk, EventType } from "../../../models/walk.model";
import { WalkEditLeaderComponent } from "./walk-edit-leader";

describe("walk status select", () => {
  function leaderPanel(accepts: boolean) {
    const panel = Object.create(WalkEditLeaderComponent.prototype) as WalkEditLeaderComponent;
    panel.displayedWalk = {status: EventType.AWAITING_LEADER} as DisplayedWalk;
    panel.statusChange = new EventEmitter<EventType>();
    panel.statusChange.subscribe(status => {
      if (accepts) {
        panel.displayedWalk.status = status;
      }
    });
    const statusModel = {control: {setValue: vi.fn()}} as unknown as NgModel;
    return {panel, statusModel};
  }

  it("puts the select back to the walk's status when the change is refused", () => {
    const {panel, statusModel} = leaderPanel(false);
    panel.onStatusSelected(EventType.APPROVED, statusModel);
    expect(statusModel.control.setValue).toHaveBeenCalledWith(EventType.AWAITING_LEADER, {emitViewToModelChange: false});
  });

  it("leaves the select alone when the change is accepted", () => {
    const {panel, statusModel} = leaderPanel(true);
    panel.onStatusSelected(EventType.APPROVED, statusModel);
    expect(statusModel.control.setValue).not.toHaveBeenCalled();
  });
});
