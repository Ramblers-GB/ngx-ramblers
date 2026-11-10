import {TestBed} from "@angular/core/testing";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {UiActionsService} from "../ui-actions.service";
import {ComposerMessagePreferencesService} from "./composer-message-preferences.service";

describe("composer message preferences", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({providers: [ComposerMessagePreferencesService, {provide: UiActionsService, useValue: {
      initialBooleanValueFor: () => true,
      initialObjectValueFor: () => [],
      saveValueFor: vi.fn()
    }}]});
  });

  it("remembers dismissals and restores them", () => {
    const preferences = TestBed.inject(ComposerMessagePreferencesService);
    preferences.dismiss("Recipient addresses are private");
    expect(preferences.hidden("Recipient addresses are private")).toBe(true);
    preferences.restore();
    expect(preferences.hidden("Recipient addresses are private")).toBe(false);
  });

  it("shows dismissed messages while progress is blocked", () => {
    const preferences = TestBed.inject(ComposerMessagePreferencesService);
    preferences.dismiss("Choose recipients");
    preferences.blocking = () => true;
    expect(preferences.hidden("Choose recipients")).toBe(false);
    preferences.dismiss("Sender is missing");
    preferences.blocking = () => false;
    expect(preferences.hidden("Sender is missing")).toBe(false);
  });

  it("shows saved dismissals when remembering is disabled", () => {
    const preferences = TestBed.inject(ComposerMessagePreferencesService);
    preferences.dismiss("Programme guidance");
    preferences.setRemember(false);
    expect(preferences.hidden("Programme guidance")).toBe(false);
  });
});
