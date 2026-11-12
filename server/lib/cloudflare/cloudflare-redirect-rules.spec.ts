import expect from "expect";
import { afterEach, describe, it } from "mocha";
import sinon from "sinon";
import { CustomDomainStatus } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { ensureHostRedirectRule, redirectRuleDescription, upgradeManagedHostRedirects } from "./cloudflare-redirect-rules";
import { cloudflareApi } from "./cloudflare.model";

const apex = "group.example.org.uk";
const www = `www.${apex}`;
const config = {apiToken: "token", zoneId: "zone-1"};
const rule = (id: string, from: string, status: number, enabled = true) => ({
  id,
  action: "redirect",
  action_parameters: {from_value: {
    status_code: status,
    target_url: {expression: `concat("https://${apex}", http.request.uri.path)`},
    preserve_query_string: true
  }},
  expression: `(http.host eq "${from}")`,
  description: redirectRuleDescription(from),
  enabled
});

describe("Managed hostname redirects", () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  it("creates new redirects that preserve the request method", async () => {
    const request = sandbox.stub(global, "fetch");
    request.onFirstCall().resolves(Response.json({success: false}, {status: 404}));
    request.onSecondCall().resolves(Response.json({success: true}));
    await ensureHostRedirectRule(config, {fromHost: www, toHost: apex});
    expect(JSON.parse(request.secondCall.args[1].body as string).rules[0].action_parameters)
      .toEqual(rule("unused", www, 307).action_parameters);
  });

  it("updates only the enabled legacy rule for the deployed domain", async () => {
    const request = sandbox.stub(global, "fetch");
    request.onFirstCall().resolves(Response.json({success: true, result: {
      id: "ruleset-1",
      rules: [rule("legacy", www, 302), rule("unrelated", "other.example.org.uk", 302), rule("disabled", apex, 302, false)]
    }}));
    request.onSecondCall().resolves(Response.json({success: true}));
    request.onThirdCall().resolves(Response.json({success: true, result: {id: "ruleset-1", rules: [rule("legacy", www, 307)]}}));
    const domains = [{hostname: apex, zoneId: config.zoneId, status: CustomDomainStatus.ATTACHED, addedAt: 0}];
    expect(await upgradeManagedHostRedirects(config.apiToken, domains)).toEqual([redirectRuleDescription(www)]);
    expect(request.secondCall.args[0]).toBe(cloudflareApi.zoneRulesetRule(config.zoneId, "ruleset-1", "legacy"));
    expect(request.secondCall.args[1].method).toBe("PATCH");
    const {id, ...expected} = rule("legacy", www, 307);
    expect(JSON.parse(request.secondCall.args[1].body as string)).toEqual(expected);
    expect(await upgradeManagedHostRedirects(config.apiToken, domains)).toEqual([]);
    expect(request.callCount).toBe(3);
  });
});
