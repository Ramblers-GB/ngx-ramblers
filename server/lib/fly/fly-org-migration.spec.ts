import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { SetupStepStatus } from "../../../projects/ngx-ramblers/src/app/models/environment-setup.model";
import * as flyPublicIps from "./fly-public-ips";
import { ensureMigratedAppHasPublicIps } from "./fly-org-migration";

describe("ensureMigratedAppHasPublicIps", () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it("allocates public IPs and reports both families", async () => {
    const ensure = sandbox.stub(flyPublicIps, "ensureAppPublicIps").resolves({ ipv4: "192.0.2.20", ipv6: "2001:db8::20" });
    const report = sandbox.spy();
    await ensureMigratedAppHasPublicIps("ngx-ramblers-example-group", "fictional-token", report);
    expect(ensure.calledOnceWithExactly({
      apiToken: "fictional-token",
      appName: "ngx-ramblers-example-group"
    })).toBe(true);
    expect(report.firstCall.args[0]).toBe("Ensuring public IPv4 and IPv6 for ngx-ramblers-example-group");
    expect(report.secondCall.args).toEqual([
      "Public IPs for ngx-ramblers-example-group: IPv4 192.0.2.20, IPv6 2001:db8::20",
      SetupStepStatus.Completed
    ]);
  });
});
