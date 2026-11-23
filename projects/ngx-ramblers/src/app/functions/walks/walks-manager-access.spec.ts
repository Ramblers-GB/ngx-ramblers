import { walksManagerAccessFrom, walksManagerAccessWithStatus, walksManagerLoginUnsaved } from "./walks-manager-access";
import { WalksManagerAccessStatus } from "../../models/walks-manager-access.model";

describe("Walks Manager access", () => {
  it("reports a rejected login before anything else", () => {
    expect(walksManagerAccessFrom(true, false, false).status).toBe(WalksManagerAccessStatus.LOGIN_FAILED);
  });

  it("accepts a login whose Create menu offers the walks CSV upload", () => {
    expect(walksManagerAccessFrom(false, true, true).status).toBe(WalksManagerAccessStatus.UPLOAD_AVAILABLE);
  });

  it("tells a working login without upload access apart from a rejected one", () => {
    expect(walksManagerAccessFrom(false, true, false).status).toBe(WalksManagerAccessStatus.NO_UPLOAD_ACCESS);
  });

  it("does not blame upload access when the page never showed the Create menu", () => {
    expect(walksManagerAccessFrom(false, false, false).status).toBe(WalksManagerAccessStatus.NOT_CHECKED);
  });

  it("adds the reason when a check could not finish", () => {
    expect(walksManagerAccessWithStatus(WalksManagerAccessStatus.NOT_CHECKED, "the login page did not load").message)
      .toBe("The Walks Manager login could not be checked: the login page did not load");
  });
});

describe("unsaved Walks Manager login", () => {
  it("treats the saved login, shown with its password as ***, as saved", () => {
    expect(walksManagerLoginUnsaved({userName: "leader@example.org", password: "***"}, "leader@example.org")).toBe(false);
  });

  it("treats a newly typed password as unsaved", () => {
    expect(walksManagerLoginUnsaved({userName: "leader@example.org", password: "fictional-new-password"}, "leader@example.org")).toBe(true);
  });

  it("treats a changed user name as unsaved", () => {
    expect(walksManagerLoginUnsaved({userName: "other@example.org", password: "***"}, "leader@example.org")).toBe(true);
  });
});
