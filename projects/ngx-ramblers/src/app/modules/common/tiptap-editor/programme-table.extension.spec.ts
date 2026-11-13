/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {Editor} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {Markdown} from "@tiptap/markdown";
import {TableRow} from "@tiptap/extension-table-row";
import {TableHeader} from "@tiptap/extension-table-header";
import {MergeField} from "./merge-field.extension";
import {HtmlBold, HtmlItalic, SafeParagraph} from "./html-marks.extension";
import {ProgrammeTable, ProgrammeTableCell} from "./programme-table.extension";
import {PROGRAMME_EVENT_TEMPLATES, ProgrammeEventFormat} from "../../../models/email-composer.model";

describe("print/post table markdown round-trip", () => {
  function editor() {
    return new Editor({
      extensions: [
        StarterKit.configure({paragraph: false, bold: false, italic: false, heading: {levels: [1, 2, 3, 4, 5, 6]}}),
        SafeParagraph,
        HtmlBold,
        HtmlItalic,
        MergeField,
        Markdown,
        ProgrammeTable.configure({resizable: false, allowTableNodeSelection: true}),
        TableRow,
        TableHeader,
        ProgrammeTableCell
      ],
      content: "",
      contentType: "markdown"
    });
  }

  it("keeps colspan, alignment, presentation role and merge fields when toggling markdown", () => {
    const original = PROGRAMME_EVENT_TEMPLATES[ProgrammeEventFormat.PRINT];
    const instance = editor();
    try {
      instance.commands.setContent(original, {contentType: "markdown"});
      const markdown = instance.getMarkdown();
      expect(markdown).toContain("role=\"presentation\"");
      expect(markdown).toContain("colspan=\"2\"");
      expect(markdown).toContain("text-align:right");
      expect(markdown).toContain("border-collapse:collapse");
      expect(markdown).toContain("table-layout:fixed");
      expect(markdown).toContain("width=\"50%\"");
      expect(markdown).toContain("<hr>");
      expect(markdown).toContain("{{title}}");
      expect(markdown).toContain("{{description}}");
      expect(markdown).toContain("<strong>{{date}}");
      expect(markdown).toContain("<strong>{{title}}");
      expect(markdown).toContain("{{grid-reference}}");
      expect(markdown).toContain("</strong><br>{{grid-reference}}");
      expect(markdown).toContain("{{contact-name}}");
      expect(markdown).not.toContain("| ---");
      instance.commands.setContent(markdown, {contentType: "markdown"});
      const again = instance.getMarkdown();
      expect(again).toContain("role=\"presentation\"");
      expect(again).toContain("colspan=\"2\"");
      expect(again).toContain("<strong>{{date}}");
      expect(again).toContain("<strong>{{title}}");
      expect(again).toContain("{{description}}");
    } finally {
      instance.destroy();
    }
  });

  it("keeps bold on merge fields after toggling it in the editor", () => {
    const instance = editor();
    try {
      instance.commands.setContent("<table role=\"presentation\"><tr><td>{{date}} {{time}}</td></tr></table>", {contentType: "markdown"});
      instance.commands.selectAll();
      instance.commands.toggleBold();
      const markdown = instance.getMarkdown();
      expect(markdown).toContain("<strong>");
      expect(markdown).toContain("{{date}}");
      instance.commands.setContent(markdown, {contentType: "markdown"});
      expect(instance.getMarkdown()).toContain("<strong>{{date}}");
    } finally {
      instance.destroy();
    }
  });

  it("still serialises a simple listing as a markdown table", () => {
    const instance = editor();
    try {
      instance.commands.setContent(PROGRAMME_EVENT_TEMPLATES[ProgrammeEventFormat.LISTING], {contentType: "markdown"});
      const markdown = instance.getMarkdown();
      expect(markdown).toContain("|");
      expect(markdown).toContain("---");
      expect(markdown).not.toContain("<table");
    } finally {
      instance.destroy();
    }
  });
});
