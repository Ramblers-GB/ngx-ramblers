import {TestBed} from "@angular/core/testing";
import {describe, expect, it, vi} from "vitest";
import {ClipboardService} from "../../../services/clipboard.service";
import {SECRET_MASK} from "../../../models/config.model";
import {SecretInputComponent} from "./secret-input.component";

function render(value: string) {
  TestBed.configureTestingModule({
    imports: [SecretInputComponent],
    providers: [{provide: ClipboardService, useValue: {copyToClipboard: vi.fn()}}]
  });
  const fixture = TestBed.createComponent(SecretInputComponent);
  const changes: string[] = [];
  fixture.componentInstance.registerOnChange((changed: string) => changes.push(changed));
  fixture.componentInstance.writeValue(value);
  fixture.detectChanges();
  const input: HTMLInputElement = fixture.nativeElement.querySelector("input");
  return {fixture, input, changes};
}

function type(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input"));
}

describe("secret input", () => {
  it("shows a saved secret as saved, with nothing to reveal or copy", () => {
    const {fixture, input} = render(SECRET_MASK);
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Saved - type a new value to replace it");
    expect(fixture.nativeElement.querySelectorAll("button").length).toBe(0);
  });

  it("sends a newly typed secret, and goes back to keeping the saved one when cleared", () => {
    const {input, changes} = render(SECRET_MASK);
    type(input, "new-key");
    type(input, "");
    expect(changes).toEqual(["new-key", SECRET_MASK]);
  });

  it("still reveals and copies a value that is not saved on the server", () => {
    const {fixture, input} = render("visible-value");
    expect(input.value).toBe("visible-value");
    expect(fixture.nativeElement.querySelectorAll("button").length).toBe(2);
  });
});
