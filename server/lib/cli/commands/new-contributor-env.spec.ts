import expect from "expect";
import { describe, it } from "mocha";
import { uncommittedChanges } from "./new-contributor-env";

describe("uncommittedChanges", () => {
  it("treats a clean status as no changes", () => {
    expect(uncommittedChanges("")).toEqual([]);
    expect(uncommittedChanges("\n")).toEqual([]);
  });

  it("lists modified and untracked files", () => {
    expect(uncommittedChanges(" M server/lib/server.ts\n?? notes.txt\n")).toEqual([" M server/lib/server.ts", "?? notes.txt"]);
  });
});
