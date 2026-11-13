import {renderEmailComposerMarkdown} from "../../functions/email-composer-markdown";
import {MailMessagingService} from "../mail/mail-messaging.service";
import {inject, Injectable} from "@angular/core";
import {DOCUMENT} from "@angular/common";
import {EmailComposerSessionService} from "./email-composer-session.service";
import {EmailComposerProgramme, ProgrammeEventFormat, PROGRAMME_EVENT_TEMPLATES} from "../../models/email-composer.model";
import {CommitteeDocumentLayout, CommitteeFile} from "../../models/committee.model";
import {normaliseMarkdownText} from "../../functions/markdown";
import {Subject} from "rxjs";
import {BrandingMode, TemplateRenderRequest} from "../../models/mail.model";
import {PageContent} from "../../models/content-text.model";
import {EventTemplateRenderingService} from "../mail/event-template-rendering.service";
import {EventTemplateService} from "../mail/event-template.service";

@Injectable()
export class EmailComposerProgrammeService {
  readonly edited = new Subject<void>();
  private mail = inject(MailMessagingService);
  private session = inject(EmailComposerSessionService);
  private rendering = inject(EventTemplateRenderingService);
  private documentRef = inject(DOCUMENT);
  private templates = inject(EventTemplateService);
  private previewSignature = "";
  private previewDocument: CommitteeFile | null = null;
  private previewRevision = 0;


  settings(): EmailComposerProgramme {
    if (!this.session.state.programme) {
      this.session.state.programme = {
        templateId: null,
        format: ProgrammeEventFormat.EMAIL,
        customTemplate: PROGRAMME_EVENT_TEMPLATES[ProgrammeEventFormat.CUSTOM],
        eventFormats: {},
        markdown: null,
        documentMarkdown: null,
        layout: CommitteeDocumentLayout.A4_PORTRAIT
      };
      void this.applySavedFormatIfNeeded();
    }
    return this.session.state.programme;
  }

  generated(): boolean {
    return this.session.state.programme?.markdown !== null && this.session.state.programme?.markdown !== undefined;
  }

  formatted(): boolean {
    const programme = this.session.state.programme;
    return !!programme && (programme.format !== ProgrammeEventFormat.EMAIL
      || this.session.state.groupEvents.some(event => event.selected && !event.deleted
        && (programme.eventFormats?.[event.id] ?? ProgrammeEventFormat.EMAIL) !== ProgrammeEventFormat.EMAIL));
  }

  formatChanged(): void {
    this.settings().eventFormats = {};
    this.useLiveEvents();
  }

  async selectFormat(): Promise<void> {
    this.settings().templateId = null;
    this.formatChanged();
    await this.applySavedFormatIfNeeded();
    this.previewSignature = "";
    this.previewDocument = null;
    this.previewRevision += 1;
    this.session.contentChanged.next();
  }

  applySavedFormatIfNeeded(refreshLiveTemplate = false): Promise<void> {
    return this.loadSavedFormat(refreshLiveTemplate);
  }

  private async loadSavedFormat(refreshLiveTemplate: boolean): Promise<void> {
    const programme = this.session.state.programme;
    const format = programme?.format ?? ProgrammeEventFormat.EMAIL;
    if (programme && format !== ProgrammeEventFormat.CUSTOM) {
      try {
        const saved = (await this.templates.available()).find(template => template.path.endsWith(`/${format}`) && template.id);
        if (saved && this.session.state.programme === programme && programme.format === format
          && programme.markdown == null && programme.documentMarkdown == null
          && (refreshLiveTemplate || !programme.templateId)) {
          const markdown = this.templates.content(saved);
          const live = this.session.state.programme;
          if (live.customTemplate !== markdown || live.templateId !== saved.id) {
            live.templateId = saved.id ?? null;
            live.customTemplate = markdown;
            live.imageHeight = this.templates.imageHeight(saved);
            this.useLiveEvents();
          }
        }
      } catch (error) {
        this.session.notify.error({title: "Could not load the saved event format", message: error.message});
      }
    }
  }

  private liveMarkdown(firstEventOnly = false): string {
    const selected = this.session.state.groupEvents.filter(event => event.selected && !event.deleted)
      .sort((left, right) => left.eventDate - right.eventDate);
    const events = firstEventOnly ? selected.slice(0, 1) : selected;
    const emailIds = new Set(events.filter(event => (this.settings().eventFormats[event.id] || this.settings().format) === ProgrammeEventFormat.EMAIL).map(event => event.id));
    const emailMarkdown = emailIds.size > 0 ? [...this.documentRef.querySelectorAll<HTMLElement>("[data-composer-event-id]")]
      .filter(element => emailIds.has(element.dataset.composerEventId))
      .reduce((markdown, element) => ({...markdown, [element.dataset.composerEventId]: normaliseMarkdownText(element.innerHTML) || ""}), {} as Record<string, string>) : {};
    return this.rendering.markdown(events, this.settings(), this.session.state.groupEventsFilter,
      events.reduce((result, event) => ({...result, [event.id]: emailMarkdown[event.id] || ""}), {} as Record<string, string>));
  }

  contentMarkdown(): string {
    return this.session.state.programme?.markdown ?? this.liveMarkdown();
  }

  previewHtml(): string {
    return this.rendering.emailHtml(this.liveMarkdown(true), this.settings().imageHeight);
  }

  previewRequest(): TemplateRenderRequest {
    return this.rendering.previewRequest(this.previewHtml(), this.session.state.notificationConfig, this.session.state.brandingMode);
  }

  generate(): void {
    try {
      const markdown = this.liveMarkdown();
      if (markdown.trim()) {
        this.settings().markdown = markdown;
        this.edited.next();
        this.session.contentChanged.next();
      } else {
        this.session.notify.error({title: "Programme is empty", message: "Select at least one event and use a template containing event content."});
      }
    } catch (error) {
      this.session.notify.error({title: "Could not generate the programme", message: error.message});
    }
  }

  updateMarkdown(value: string): void {
    this.settings().markdown = value;
    this.edited.next();
    this.session.contentChanged.next();
  }

  useLiveEvents(): void {
    this.settings().markdown = null;
    this.settings().documentMarkdown = null;
    this.previewSignature = "";
    this.previewDocument = null;
    this.previewRevision += 1;
    this.edited.next();
    this.session.contentChanged.next();
  }

  documentRevision(): number {
    return this.previewRevision;
  }

  updateDocumentMarkdown(value: string): void {
    const live = this.composedMarkdown();
    if ((value || "").trim() === live.trim()) {
      this.settings().documentMarkdown = null;
    } else {
      this.settings().documentMarkdown = value;
    }
    this.edited.next();
    this.session.contentChanged.next();
  }

  selectImageHeight(height: number): void {
    this.settings().imageHeight = height;
    this.edited.next();
    this.session.contentChanged.next();
  }

  selectLayout(layout: CommitteeDocumentLayout): void {
    this.settings().layout = layout;
    this.previewSignature = "";
    this.edited.next();
    this.session.contentChanged.next();
  }

  applyTemplate(template: PageContent, format = ProgrammeEventFormat.CUSTOM): void {
    const markdown = this.templates.content(template);
    if (markdown.trim()) {
      this.settings().templateId = template.id ?? null;
      this.settings().customTemplate = markdown;
      this.settings().format = format;
      this.settings().imageHeight = this.templates.imageHeight(template);
      this.formatChanged();
    } else {
      this.session.notify.error({title: "Template has no event content", message: "Choose a template containing event fields and text."});
    }
  }

  emailHtml(): string {
    return this.rendering.emailHtml(this.contentMarkdown(), this.settings().imageHeight);
  }

  document(preferStored = true): CommitteeFile {
    const title = this.session.state.subject || "Events programme";
    const layout = this.settings().layout || CommitteeDocumentLayout.A4_PORTRAIT;
    try {
      const stored = this.settings().documentMarkdown || "";
      const storedHasContent = !!stored.trim() && stored.trim() !== `# ${title.replace(/[\r\n]+/g, " ")}`;
      const source = preferStored && storedHasContent ? stored : this.composedMarkdown();
      const signoff = this.signoffParts();
      const signature = JSON.stringify([title, source, signoff, layout, preferStored, this.settings().format, this.previewRevision]);
      if (signature !== this.previewSignature || !this.previewDocument?.document?.markdown) {
        this.previewSignature = signature;
        const markdown = this.withSignoff(source, signoff);
        this.previewDocument = {fileType: "Events programme", document: {title, markdown, layout}};
      }
      return this.previewDocument;
    } catch {
      this.previewSignature = "";
      this.previewDocument = {fileType: "Events programme", document: {title, markdown: `# ${title.replace(/[\r\n]+/g, " ")}`, layout}};
      return this.previewDocument;
    }
  }

  private signoffParts(): string[] {
    const state = this.session.state;
    const roles = state.brandingMode === BrandingMode.UNBRANDED ? [] : state.signoffRoles || [];
    return [
      ...(state.signoffTextMarkdown || "").trim().split(/\n\s*\n/),
      ...roles.map(role => normaliseMarkdownText(this.mail.signoffNames([role])) || "")
    ].filter(part => part.trim());
  }

  private withSignoff(markdown: string, parts: string[]): string {
    const existing = this.markdownText(markdown);
    const missing = parts.filter(part => !existing.includes(this.markdownText(part)));
    return [markdown, ...missing].filter(Boolean).join("\n\n");
  }

  private markdownText(markdown: string): string {
    const content = this.documentRef.createElement("div");
    content.innerHTML = renderEmailComposerMarkdown(markdown);
    return (content.textContent || "").replace(/\s+/g, " ").trim();
  }

  private composedMarkdown(): string {
    const state = this.session.state;
    const title = state.subject || "Events programme";
    return [
      `# ${title.replace(/[\r\n]+/g, " ")}`,
      (state.introMarkdown || "").trim(),
      this.contentMarkdown(),
      ...this.signoffParts()
    ].filter(Boolean).join("\n\n");
  }
}
