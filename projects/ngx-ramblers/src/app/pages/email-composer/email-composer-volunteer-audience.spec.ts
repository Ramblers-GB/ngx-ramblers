import { describe, expect, it, vi } from "vitest";
import { of } from "rxjs";
import { EmailComposer } from "./email-composer";
import { defaultEmailComposerState } from "../../functions/email-composer";
import { Member } from "../../models/member.model";
import { VolunteerAssignmentScope, VolunteerAssignmentStatus, VolunteerAudienceType, VolunteerRoleType } from "../../models/volunteer-management.model";
import { fakeComposerSources } from "../../testing/fake-composer-sources";

describe("composer volunteer audience", () => {
  it("looks up every volunteer before working out the audience, so none are left out as having no supporter record", async () => {
    const volunteers = ["v1", "v2", "v3"].map(id => ({id, firstName: id, lastName: "Volunteer", email: `${id}@example.com`, groupMember: true} as Member));
    const recipientSources = fakeComposerSources({members: volunteers, loadedIds: []});
    const ensureMembers = vi.spyOn(recipientSources, "ensureMembers");
    const state = defaultEmailComposerState();
    state.context = {volunteerAudience: {audienceType: VolunteerAudienceType.LOCAL_FOOTPATH_OFFICERS}};
    const assignments = volunteers.map(volunteer => ({
      supporterId: volunteer.id,
      roleType: VolunteerRoleType.LOCAL_FOOTPATH_OFFICER,
      status: VolunteerAssignmentStatus.ACTIVE,
      scope: VolunteerAssignmentScope.RIGHTS_OF_WAY_GROUP
    }));
    const instance = Object.create(EmailComposer.prototype);
    Object.assign(instance, {
      session: {state, systemConfig: {group: {groupCode: "KT"}}, notify: {error: vi.fn()}},
      recipientSources,
      volunteerManagementService: {snapshot: () => of({parishes: [], assignments})},
      externalRecipientService: {list: async () => []},
      logger: {info: vi.fn(), error: vi.fn()}
    });
    await instance.applyVolunteerAudience();
    expect(ensureMembers).toHaveBeenCalledWith(["v1", "v2", "v3"]);
    expect(state.selectedMemberIds).toEqual(["v1", "v2", "v3"]);
    expect(instance.volunteerAudienceSummary.excluded).toEqual([]);
  });
});
