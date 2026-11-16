import expect from "expect";
import { describe, it } from "mocha";
import { unmanagedWorkerMachines, parseWorkerMachineList, workerMachinesToRetire } from "./deploy-integration-worker";
import { FlyMachineListItem } from "../lib/fly/fly.model";

function machine(id: string, processGroup: string, tag: string): FlyMachineListItem {
  return {
    id,
    state: "started",
    config: {metadata: processGroup ? {fly_process_group: processGroup} : {}},
    image_ref: {repository: "example.registry/ngx-ramblers", tag}
  };
}

describe("parseWorkerMachineList", () => {
  it("reads a Fly JSON array of machines", () => {
    const parsed = parseWorkerMachineList(JSON.stringify([machine("keep", "app", "integration-worker-1086")]));
    expect(parsed.map(item => item.id)).toEqual(["keep"]);
  });

  it("treats a non-array payload as no machines", () => {
    expect(parseWorkerMachineList("{\"id\":\"x\"}")).toEqual([]);
  });
});

describe("unmanagedWorkerMachines", () => {
  it("selects machines that are not in the Launch app process group", () => {
    const current = machine("keep", "app", "integration-worker-1086");
    const stray = machine("stray", "", "integration-worker-1081");
    expect(unmanagedWorkerMachines([current, stray]).map(item => item.id)).toEqual(["stray"]);
  });
});

describe("workerMachinesToRetire", () => {
  it("keeps the Launch app machine that is already on the requested image", () => {
    expect(workerMachinesToRetire([machine("keep", "app", "integration-worker-1086")], "integration-worker-1086")).toEqual([]);
  });

  it("retires a machine with no process group even if it is still started", () => {
    expect(workerMachinesToRetire([machine("stray", "", "integration-worker-1081")], "integration-worker-1086").map(item => item.id)).toEqual(["stray"]);
  });

  it("retires a Launch machine that is still on an older worker image", () => {
    expect(workerMachinesToRetire([machine("stale", "app", "integration-worker-1081")], "integration-worker-1086").map(item => item.id)).toEqual(["stale"]);
  });

  it("leaves an empty list unchanged", () => {
    expect(workerMachinesToRetire([], "integration-worker-1086")).toEqual([]);
  });
});
