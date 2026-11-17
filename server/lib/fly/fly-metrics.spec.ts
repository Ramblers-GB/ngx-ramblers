import expect from "expect";
import { describe, it } from "mocha";
import { noCurrentMetricsMessage } from "./fly-metrics";

describe("noCurrentMetricsMessage", () => {
  it("says a suspended machine is suspended instead of suggesting a restart", () => {
    const message = noCurrentMetricsMessage("ngx-ramblers-integration-worker", "17811120db2678", "ramblers-association", "suspended");
    expect(message).toEqual("No current memory reading for app ngx-ramblers-integration-worker machine 17811120db2678: the machine is suspended, so Fly is not collecting metrics until it next starts");
  });

  it("says a running machine may have only just started", () => {
    expect(noCurrentMetricsMessage("ngx-ramblers", "abc", "ramblers-association", "started")).toContain("the machine is running, so it may have only just started");
  });

  it("reports any other machine state as it is", () => {
    expect(noCurrentMetricsMessage("ngx-ramblers", "abc", "ramblers-association", "replacing")).toEqual("No current memory reading for app ngx-ramblers machine abc: the machine is replacing");
  });

  it("says when the machine state could not be read", () => {
    expect(noCurrentMetricsMessage("ngx-ramblers", "", "ramblers-association", null)).toEqual("No memory metrics found for app ngx-ramblers in org ramblers-association, and its state could not be read");
  });
});
