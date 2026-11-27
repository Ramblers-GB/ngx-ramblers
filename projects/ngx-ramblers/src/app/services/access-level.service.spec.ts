import { MemberResourcesReferenceDataService } from "./member/member-resources-reference-data.service";
import { TestBed } from "@angular/core/testing";
import { AccessLevel } from "../models/member-resource.model";
import { AccessLevelService } from "./access-level.service";
import { MemberLoginService } from "./member/member-login.service";

describe("AccessLevelService", () => {
  const loginState = {loggedIn: false, committee: false, memberAdmin: false, emailedAccess: false};

  beforeEach(() => {
    loginState.loggedIn = false;
    loginState.committee = false;
    loginState.memberAdmin = false;
    loginState.emailedAccess = false;
    TestBed.configureTestingModule({
      providers: [
        AccessLevelService,
        {provide: MemberResourcesReferenceDataService, useValue: {platformAdminOn: () => false}},
        {
          provide: MemberLoginService,
          useValue: {
            loggedInMember: () => loginState.loggedIn ? {memberId: "member-1", committee: loginState.committee, memberAdmin: loginState.memberAdmin} : null,
            memberLoggedIn: () => loginState.loggedIn,
            emailedAccessActive: () => loginState.emailedAccess,
            allowCommittee: () => loginState.committee,
            allowMemberAdminEdits: () => loginState.memberAdmin
          }
        }
      ]
    });
  });

  it("shows not-logged-in items to visitors and hides them from members", () => {
    const service = TestBed.inject(AccessLevelService);
    expect(service.hasAccessLevel(AccessLevel.NOT_LOGGED_IN)).toBe(true);
    loginState.loggedIn = true;
    expect(service.hasAccessLevel(AccessLevel.NOT_LOGGED_IN)).toBe(false);
  });

  it("keeps public items visible whether or not someone is logged in", () => {
    const service = TestBed.inject(AccessLevelService);
    expect(service.hasAccessLevel(AccessLevel.PUBLIC)).toBe(true);
    loginState.loggedIn = true;
    expect(service.hasAccessLevel(AccessLevel.PUBLIC)).toBe(true);
  });

  it("shows logged-in-member items only after login", () => {
    const service = TestBed.inject(AccessLevelService);
    expect(service.hasAccessLevel(AccessLevel.LOGGED_IN_MEMBER)).toBe(false);
    loginState.loggedIn = true;
    expect(service.hasAccessLevel(AccessLevel.LOGGED_IN_MEMBER)).toBe(true);
  });

  it("shows logged-in-member items, but not committee items, to someone who opened an emailed document link", () => {
    const service = TestBed.inject(AccessLevelService);
    loginState.emailedAccess = true;
    expect(service.hasAccessLevel(AccessLevel.LOGGED_IN_MEMBER)).toBe(true);
    expect(service.hasAccessLevel(AccessLevel.COMMITTEE)).toBe(false);
    expect(service.hasAccessLevel(AccessLevel.NOT_LOGGED_IN)).toBe(true);
  });
});
