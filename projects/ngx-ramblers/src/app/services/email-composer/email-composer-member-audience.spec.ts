import {describe, expect, it, vi} from "vitest";
import {defaultEmailComposerState} from "../../functions/email-composer";
import {RecipientMode} from "../../models/email-composer.model";
import {Member} from "../../models/member.model";
import {MemberSelection} from "../../models/mail.model";
import {EmailComposerRecipientsService} from "./email-composer-recipients.service";
import {fakeComposerSources} from "../../testing/fake-composer-sources";

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe("composer member audience", () => {
  function service() {
    const state = defaultEmailComposerState();
    state.recipientMode = RecipientMode.SELECTED_MEMBERS;
    const candidates = [
      {id: "alex", email: "alex@example.com"}, {id: "sam", email: "sam@example.com"}
    ] as Member[];
    const instance = Object.create(EmailComposerRecipientsService.prototype);
    Object.assign(instance, {
      session: {state, syncStateToUrl: vi.fn()},
      expandedRecipientFilterKeys: new Set(),
      preFilterAudienceToken: 0,
      pool: fakeComposerSources({members: candidates, selection: request => request.preFilterKey ? ["alex"] : ["alex", "sam"]}),
      onFilteredMemberIdsChange: async (ids: string[]) => { state.selectedMemberIds = ids; }
    });
    return instance;
  }

  it("selects everyone after leaving the configured filter", async () => {
    const instance = service();
    instance.session.state.preFilterKey = MemberSelection.RECENTLY_ADDED;
    instance.setNarrowListId = async (id: number | null) => { instance.session.state.narrowListId = id; };
    await instance.chooseMemberAudience(null);
    await flush();
    expect(instance.session.state.preFilterKey).toBe(null);
    expect(instance.session.state.selectedMemberIds).toEqual(["alex", "sam"]);
  });

  it("clears the list restriction when choosing the configured filter", async () => {
    const instance = service();
    instance.session.state.narrowListId = 42;
    instance.onPreFilterKeyChange(MemberSelection.RECENTLY_ADDED);
    await flush();
    expect(instance.session.state.narrowListId).toBe(null);
    expect(instance.session.state.selectedMemberIds).toEqual(["alex"]);
  });
});
