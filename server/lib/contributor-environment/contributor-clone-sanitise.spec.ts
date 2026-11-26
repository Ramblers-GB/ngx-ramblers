import expect from "expect";
import { describe, it } from "mocha";
import { ObjectId } from "mongodb";
import { ConfigKey } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import {
  CONTRIBUTOR_CLONE_EXCLUDED_COLLECTIONS,
  CONTRIBUTOR_LOCAL_SITE_URL,
  MEMBER_PERSONAL_FIELDS,
  memberAnonymisationFilter,
  memberAnonymisationPipeline,
  sanitiseContributorClone
} from "./contributor-clone-sanitise";

function recordingDb(systemValue: Record<string, unknown>) {
  const calls: {collection: string; operation: string; args: unknown[]}[] = [];
  const db = {
    collection: (name: string) => ({
      findOne: async () => name === "config" ? {key: ConfigKey.SYSTEM, value: systemValue} : null,
      updateOne: async (...args: unknown[]) => calls.push({collection: name, operation: "updateOne", args}),
      updateMany: async (...args: unknown[]) => calls.push({collection: name, operation: "updateMany", args}),
      deleteMany: async (...args: unknown[]) => calls.push({collection: name, operation: "deleteMany", args})
    })
  };
  return {db, calls};
}

describe("contributor clone exclusions", () => {
  it("leaves out inbox mail, audit history, tokens and AUTH_SECRET-encrypted credentials", () => {
    ["inboxMessages", "inboxThreads", "memberAudit", "memberUpdateAudit", "refreshTokens", "mailClientCredentials", "osMapsPersonalAccounts", "emailCompositions", "expenseClaims"]
      .forEach(collection => expect(CONTRIBUTOR_CLONE_EXCLUDED_COLLECTIONS).toContain(collection));
  });

  it("keeps the content a contributor works on", () => {
    ["members", "config", "pageContent", "walks", "extendedGroupEvents", "contentMetaData"]
      .forEach(collection => expect(CONTRIBUTOR_CLONE_EXCLUDED_COLLECTIONS).not.toContain(collection));
  });
});

describe("member anonymisation", () => {
  it("keeps the requesting member and anonymises everyone else", () => {
    const keep = new ObjectId().toHexString();
    expect(memberAnonymisationFilter(keep)).toEqual({_id: {$ne: new ObjectId(keep)}});
    expect(memberAnonymisationFilter(null)).toEqual({});
    expect(memberAnonymisationFilter("not-an-id")).toEqual({});
  });

  it("replaces names and addresses and removes contact details and passwords", () => {
    const [setStage, unsetStage] = memberAnonymisationPipeline();
    expect(setStage.$set.firstName).toEqual("Member");
    expect(setStage.$set.email).toEqual({$concat: ["member-", {$toString: "$_id"}, "@example.invalid"]});
    expect(setStage.$set["mail.email"]).toEqual(setStage.$set.email);
    expect(unsetStage.$unset).toEqual(MEMBER_PERSONAL_FIELDS);
    ["password", "mobileNumber", "landlineTelephone", "postcode", "membershipNumber", "salesforceId", "contactId"]
      .forEach(field => expect(MEMBER_PERSONAL_FIELDS).toContain(field));
  });
});

describe("sanitiseContributorClone", () => {
  it("clears live credentials, switches sending off and anonymises members", async () => {
    const keep = new ObjectId().toHexString();
    const {db, calls} = recordingDb({group: {href: "https://group.example.org.uk"}, national: {walksManager: {userName: "alex.reed", password: "fictional"}}});
    await sanitiseContributorClone(db as never, keep);
    const configUpdates = calls.filter(call => call.collection === "config" && call.operation === "updateOne").map(call => call.args);
    expect(configUpdates).toContainEqual([{key: ConfigKey.SYSTEM}, {$set: {"value.group.href": CONTRIBUTOR_LOCAL_SITE_URL, "value.national": {walksManager: {userName: "alex.reed", password: null}}}}]);
    expect(configUpdates).toContainEqual([{key: ConfigKey.BREVO}, {$set: {"value.apiKey": null}}]);
    expect(configUpdates).toContainEqual([{key: ConfigKey.MAILCHIMP}, {$set: {"value.apiKey": null}}]);
    expect(configUpdates).toContainEqual([{key: ConfigKey.SALESFORCE}, {$set: {"value.apiKeysByGroupCode": {}, "value.enabled": false}}]);
    const sendControl = configUpdates.find(args => (args[0] as {key: string}).key === ConfigKey.PLATFORM_SEND_CONTROL);
    expect((sendControl[1] as {$set: {value: {sendingSuspended: boolean}}}).$set.value.sendingSuspended).toBe(true);
    expect(sendControl[2]).toEqual({upsert: true});
    expect(calls).toContainEqual({collection: "config", operation: "deleteMany", args: [{key: {$in: [ConfigKey.ENVIRONMENTS, ConfigKey.SITE_REGISTRATION]}}]});
    expect(calls.find(call => call.collection === "inboxMailboxConnections")?.operation).toEqual("updateMany");
    expect(calls.find(call => call.collection === "members")?.args).toEqual([memberAnonymisationFilter(keep), memberAnonymisationPipeline()]);
  });
});
