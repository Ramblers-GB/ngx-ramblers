import { describe, expect, it } from "vitest";
import { REPOSITORY_URL } from "../models/build-version.model";
import { releaseNoteTitleSegments } from "./release-note-title";

describe("releaseNoteTitleSegments", () => {
  it("links the ticket reference to its GitHub issue and leaves the rest as text", () => {
    expect(releaseNoteTitleSegments("23-Nov-2026 — build 1115 — #345 — enable admin approval")).toEqual([
      {text: "23-Nov-2026 — build 1115 — ", issueUrl: null},
      {text: "#345", issueUrl: `${REPOSITORY_URL}/issues/345`},
      {text: " — enable admin approval", issueUrl: null}
    ]);
  });

  it("links every reference when a note covers several tickets", () => {
    const segments = releaseNoteTitleSegments("#357, #439 — guest join links");
    expect(segments.filter(segment => segment.issueUrl).map(segment => segment.text)).toEqual(["#357", "#439"]);
  });

  it("keeps a title with no ticket reference as one plain segment", () => {
    expect(releaseNoteTitleSegments("Small fixes")).toEqual([{text: "Small fixes", issueUrl: null}]);
  });
});
