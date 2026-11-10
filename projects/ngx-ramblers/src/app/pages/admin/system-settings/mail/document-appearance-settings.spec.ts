import {Component, EventEmitter, Input, Output} from "@angular/core";
import {TestBed} from "@angular/core/testing";
import {describe, expect, it, vi} from "vitest";
import {CommitteeFile} from "../../../../models/committee.model";
import {DocumentAppearance} from "../../../../models/document-appearance.model";
import {SystemConfigService} from "../../../../services/system/system-config.service";
import {TiptapMarkdownEditor} from "../../../../modules/common/tiptap-editor/tiptap-markdown-editor";
import {CommitteeDocumentView} from "../../../committee/document/committee-document-view";
import {DocumentAppearanceSettingsComponent} from "./document-appearance-settings";

@Component({selector: "app-committee-document-view", template: ""})
class DocumentPreviewStub {
  @Input() committeeFile: CommitteeFile;
  @Input() appearance: DocumentAppearance;
}

@Component({selector: "app-tiptap-markdown-editor", template: ""})
class FooterEditorStub {
  @Input() value: string;
  @Output() valueChange = new EventEmitter<string>();
}

describe("document appearance settings", () => {
  it("previews changes without saving and saves only when requested", async () => {
    const config = {group: {longName: "Hillside Park"}, documentAppearance: {showContactEmail: false}};
    const saveConfig = vi.fn().mockResolvedValue(null);
    TestBed.configureTestingModule({imports: [DocumentAppearanceSettingsComponent], providers: [
      {provide: SystemConfigService, useValue: {systemConfig: () => config, saveConfig}}
    ]});
    TestBed.overrideComponent(DocumentAppearanceSettingsComponent, {remove: {imports: [TiptapMarkdownEditor, CommitteeDocumentView]}, add: {imports: [FooterEditorStub, DocumentPreviewStub]}});
    const fixture = TestBed.createComponent(DocumentAppearanceSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const email = host.querySelector<HTMLInputElement>("#document-contact-email");
    email.value = "programme@group.example.org.uk";
    email.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(config.documentAppearance).toEqual({showContactEmail: false});
    host.querySelector<HTMLButtonElement>("button").click();
    await fixture.whenStable();
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({group: config.group, documentAppearance: expect.objectContaining({contactEmail: "programme@group.example.org.uk", showContactEmail: false})}));
  });
});
