import expect from "expect";
import sinon from "sinon";
import { filterSelection, listCounts, membersByReference, memberSearch, requireEmailComposer, summary } from "./email-composer-audience";
import { member } from "../models/member";
import { memberEmailSend } from "../models/member-email-send";
import { notificationConfig } from "../models/notification-config";
import * as config from "./config";
import { MemberSelection } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import { ComposerAudienceScope, MemberSendBlockReason, RecipientMode } from "../../../../projects/ngx-ramblers/src/app/models/email-composer.model";

describe("Email composer audience API", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const response = () => ({setHeader: sandbox.spy(), json: sandbox.spy(), status: sandbox.stub().returnsThis()});
  const resolving = (value: unknown) => ({exec: sandbox.stub().resolves(value)});
  const leanChain = (value: unknown) => {
    const chain: any = {lean: sandbox.stub().returns(resolving(value))};
    chain.sort = sandbox.stub().returns(chain);
    chain.limit = sandbox.stub().returns(chain);
    chain.skip = sandbox.stub().returns(chain);
    return chain;
  };

  it("lets only people who may use the email composer through", () => {
    const next = sandbox.spy();
    const refused = response();
    requireEmailComposer({user: {memberId: "m1", memberAdmin: true}} as any, refused as any, next);
    expect(refused.status.calledWith(403)).toBe(true);
    expect(next.called).toBe(false);
    requireEmailComposer({user: {memberId: "m2", committee: true}} as any, response() as any, next);
    expect(next.calledOnce).toBe(true);
  });

  it("counts subscribers for each list asked for in the database, flagging lists only committee members are on", async () => {
    const aggregate = sandbox.stub(member, "aggregate").resolves([{_id: 3, count: 12, committee: 4}, {_id: 5, count: 2, committee: 2}] as any);
    const res = response();
    await listCounts({query: {listIds: "3,5,7,abc"}} as any, res as any);
    expect(aggregate.firstCall.args[0][2]).toEqual({$match: {"mail.subscriptions.subscribed": true, "mail.subscriptions.id": {$in: [3, 5, 7]}}});
    expect(res.json.firstCall.args[0]).toEqual({response: [
      {listId: 3, subscriberCount: 12, committeeOnly: false},
      {listId: 5, subscriberCount: 2, committeeOnly: true},
      {listId: 7, subscriberCount: 0, committeeOnly: false}
    ]});
  });

  it("counts an audience and who cannot be emailed with database counts rather than loading members", async () => {
    sandbox.stub(config, "queryKey").resolves({value: {respectEmailBlocks: true, respectHeadOfficeConsent: true}} as any);
    const find = sandbox.stub(member, "find");
    const countDocuments = sandbox.stub(member, "countDocuments").callsFake(((query: any) => resolving(query.$and ? (query.$and[1].emailBlock ? 2 : 0) : 10)) as any);
    const res = response();
    await summary({body: {definition: {scope: ComposerAudienceScope.EVERYONE, recipientMode: RecipientMode.SELECTED_MEMBERS}}} as any, res as any);
    expect(find.called).toBe(false);
    expect(countDocuments.callCount).toBe(5);
    expect(res.json.firstCall.args[0]).toEqual({response: {total: 10, sendable: 8, unavailable: [{reason: MemberSendBlockReason.BLOCKED, count: 2}]}});
  });

  it("returns nothing for an empty member search without querying", async () => {
    const find = sandbox.stub(member, "find");
    const res = response();
    await memberSearch({query: {search: "  "}} as any, res as any);
    expect(find.called).toBe(false);
    expect(res.json.firstCall.args[0]).toEqual({response: []});
  });

  it("searches group members with an email address by name or email, escaping the search text", async () => {
    const chain = leanChain([{_id: "64b000000000000000000001", firstName: "Jo", lastName: "Hart", email: "jo@example.com"}]);
    const find = sandbox.stub(member, "find").returns(chain);
    const res = response();
    await memberSearch({query: {search: "jo.h"}} as any, res as any);
    const criteria = find.firstCall.args[0] as any;
    expect(criteria.$and[1].$or[0].firstName.source).toBe("jo\\.h");
    expect(chain.limit.calledWith(20)).toBe(true);
    expect(res.json.firstCall.args[0]).toEqual({response: [{memberId: "64b000000000000000000001", name: "Jo Hart", email: "jo@example.com"}]});
  });

  it("looks members up by id, email or committee flag, ignoring ids that are not database ids", async () => {
    const find = sandbox.stub(member, "find").returns(leanChain([{_id: "64b000000000000000000002", firstName: "Al"}]));
    const res = response();
    await membersByReference({body: {memberIds: ["64b000000000000000000002", "bogus"], emails: ["Al@Example.com"], committee: true}} as any, res as any);
    const criteria = (find.firstCall.args[0] as any).$or;
    expect(criteria[0]).toEqual({_id: {$in: ["64b000000000000000000002"]}});
    expect(criteria[1].email.$in[0].test("al@example.com")).toBe(true);
    expect(criteria[2]).toEqual({committee: true});
    expect(res.json.firstCall.args[0]).toEqual({response: [{id: "64b000000000000000000002", firstName: "Al"}]});
  });

  it("works out the member filter selection with database queries, leaving out people already sent this email", async () => {
    sandbox.stub(notificationConfig, "findById").returns({lean: sandbox.stub().returns(resolving({defaultMemberSelection: MemberSelection.RECENTLY_ADDED, postSendActions: [], monthsInPast: 1, timeUnit: "months"}))} as any);
    sandbox.stub(config, "queryKey").resolves({value: {respectEmailBlocks: true, respectHeadOfficeConsent: true}} as any);
    sandbox.stub(memberEmailSend, "aggregate").resolves([{_id: "64b000000000000000000003", sentAt: 7}] as any);
    sandbox.stub(member, "countDocuments").returns(resolving(4) as any);
    const find = sandbox.stub(member, "find");
    find.onCall(0).returns(leanChain([{_id: "64b000000000000000000001"}, {_id: "64b000000000000000000003"}]));
    find.onCall(1).returns(leanChain([{_id: "64b000000000000000000003", firstName: "Cat", lastName: "Moor"}]));
    find.onCall(2).returns(leanChain([{_id: "64b000000000000000000003"}]));
    const res = response();
    await filterSelection({body: {notificationConfigId: "64b0000000000000000000aa", recipientMode: RecipientMode.SELECTED_MEMBERS, preFilterKey: MemberSelection.RECENTLY_ADDED,
      keepMemberIds: ["64b000000000000000000002", "64b000000000000000000003"]}} as any, res as any);
    expect(find.firstCall.args[1]).toEqual({_id: 1});
    expect(res.json.firstCall.args[0]).toEqual({response: {
      candidateCount: 4,
      memberIds: ["64b000000000000000000001"],
      keptMemberIds: ["64b000000000000000000003"],
      priorSendExclusions: [{memberId: "64b000000000000000000003", name: "Cat Moor", sentAt: 7}]
    }});
  });
});
