import { WALK_LEADER_FILTER_TITLE } from "../../../models/table-filtering.model";
import { MemberAdminComponent } from "./member-admin.component";

describe("Member Admin walk leader filter", () => {
  it("reports a failed lookup and clears the failure on retry", async () => {
    const component = Object.create(MemberAdminComponent.prototype) as MemberAdminComponent;
    component.memberFilter = {selectedFilter: {title: WALK_LEADER_FILTER_TITLE}} as typeof component.memberFilter;
    component["walksAndEventsService"] = {
      queryWalkLeaders: vi.fn().mockRejectedValueOnce(new Error("Request failed")).mockResolvedValueOnce(["member-one"])
    } as unknown as typeof component["walksAndEventsService"];
    component["logger"] = {error: vi.fn()} as unknown as typeof component["logger"];
    component.applyFilterToMembers = vi.fn();

    component["loadWalkLeadersIfFiltering"]();
    expect(component.walkLeadersLoading()).toBe(true);
    await component["walkLeadersLoad"];

    expect(component.walkLeadersLoading()).toBe(false);
    expect(component.walkLeadersUnavailable()).toBe(true);

    component["loadWalkLeadersIfFiltering"]();
    expect(component.walkLeadersUnavailable()).toBe(false);
    await component["walkLeadersLoad"];

    expect(component.walkLeadersLoading()).toBe(false);
    expect(component.isWalkLeader({id: "member-one", firstName: "Alex", lastName: "Reed"})).toBe(true);
    expect(component.applyFilterToMembers).toHaveBeenCalledOnce();
  });
});
