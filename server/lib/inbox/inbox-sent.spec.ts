import expect from "expect";
import { describe, it } from "mocha";
import { InboxMessage, InboxMessageDirection, InboxThread } from "../../../projects/ngx-ramblers/src/app/models/inbox.model";
import { isRecentSentCopy, sentMessageRows, sentThreadObjectIds } from "./inbox-sent";

describe("inbox-sent", () => {

  function createThread(id: string): InboxThread {
    return {id, subject: `thread-subject-${id}`, lastDirection: InboxMessageDirection.INBOUND} as InboxThread;
  }

  function createMessage(fields: Partial<InboxMessage>): InboxMessage {
    return {
      direction: InboxMessageDirection.OUTBOUND,
      from: {name: "Committee Sender", email: "committee@example.com"},
      to: [{name: "Jane Member", email: "jane@example.com"}],
      ...fields
    } as InboxMessage;
  }

  describe("sentMessageRows", () => {

    it("should produce one row per sent message, newest first", () => {
      const threads = [createThread("a")];
      const messages = [
        createMessage({threadId: "a", messageId: "<m1>", subject: "first", sentAt: 100}),
        createMessage({threadId: "a", messageId: "<m2>", subject: "second", sentAt: 200})
      ];
      const {rows, totalCount} = sentMessageRows(threads, messages, 0, 50);
      expect(totalCount).toBe(2);
      expect(rows.map(row => row.subject)).toEqual(["second", "first"]);
      expect(rows.map(row => row.sentMessageId)).toEqual(["<m2>", "<m1>"]);
    });

    it("should exclude messages whose thread is not visible", () => {
      const messages = [createMessage({threadId: "hidden", messageId: "<m1>", sentAt: 100})];
      const {rows, totalCount} = sentMessageRows([createThread("a")], messages, 0, 50);
      expect(rows).toEqual([]);
      expect(totalCount).toBe(0);
    });

    it("should deduplicate copies of the same message across sibling threads", () => {
      const threads = [createThread("a"), createThread("b")];
      const messages = [
        createMessage({threadId: "a", messageId: "<m1>", sentAt: 100}),
        createMessage({threadId: "b", messageId: "<m1>", sentAt: 100})
      ];
      const {totalCount} = sentMessageRows(threads, messages, 0, 50);
      expect(totalCount).toBe(1);
    });

    it("should label the row with the first recipient and a count of the others", () => {
      const messages = [createMessage({
        threadId: "a",
        messageId: "<m1>",
        sentAt: 100,
        to: [{name: "Jane Member", email: "jane@example.com"}, {name: "John Member", email: "john@example.com"}]
      })];
      const {rows} = sentMessageRows([createThread("a")], messages, 0, 50);
      expect(rows[0].externalAddress).toEqual({name: "Jane Member +1", email: "jane@example.com"});
      expect(rows[0].lastDirection).toBe(InboxMessageDirection.OUTBOUND);
    });

    it("should use the individual sent message sender instead of the conversation sender", () => {
      const thread = {
        ...createThread("a"),
        sentFrom: {name: "Jane Member", email: "jane@example.com"}
      };
      const messages = [createMessage({
        threadId: "a",
        messageId: "<m1>",
        sentAt: 100,
        from: {name: "Committee Sender", email: "committee@example.com"}
      })];
      const {rows} = sentMessageRows([thread], messages, 0, 50);
      expect(rows[0].sentFrom).toEqual({name: "Committee Sender", email: "committee@example.com"});
      expect(rows[0].externalAddress).toEqual({name: "Jane Member", email: "jane@example.com"});
    });

    it("hides Outlook Sent stubs that have no recipient, subject or body", () => {
      const threads = [createThread("a")];
      const messages = [
        createMessage({threadId: "a", messageId: "<real>", subject: "Walk notes", sentAt: 200}),
        createMessage({threadId: "a", messageId: "<stub>", subject: "(no subject)", to: [], sentAt: 100})
      ];
      const {rows, totalCount} = sentMessageRows(threads, messages, 0, 50);
      expect(totalCount).toBe(1);
      expect(rows.map(row => row.sentMessageId)).toEqual(["<real>"]);
    });

    it("collapses duplicate copies of the same send from SMTP and IMAP", () => {
      const threads = [createThread("a"), createThread("b")];
      const messages = [
        createMessage({threadId: "a", messageId: "<smtp>", subject: "Re: Test of group mail", inReplyTo: "<orig>", sentAt: 1000}),
        createMessage({threadId: "b", messageId: "<imap>", subject: "Re: Test of group mail", inReplyTo: "<orig>", sentAt: 1400})
      ];
      const {rows, totalCount} = sentMessageRows(threads, messages, 0, 50);
      expect(totalCount).toBe(1);
      expect(rows[0].sentMessageId).toBe("<imap>");
    });

    it("collapses Outlook draft saves that change Message-ID and In-Reply-To", () => {
      const threads = [createThread("a")];
      const messages = [
        createMessage({threadId: "a", messageId: "<v3>", subject: "Re: Walk notes", inReplyTo: "<v2>", sentAt: 3 * 60 * 1000}),
        createMessage({threadId: "a", messageId: "<v2>", subject: "Re: Walk notes", inReplyTo: "<v1>", sentAt: 2 * 60 * 1000}),
        createMessage({threadId: "a", messageId: "<v1>", subject: "Re: Walk notes", inReplyTo: null, sentAt: 60 * 1000})
      ];
      const {rows, totalCount} = sentMessageRows(threads, messages, 0, 50);
      expect(totalCount).toBe(1);
      expect(rows[0].sentMessageId).toBe("<v3>");
    });

    it("keeps two genuine sends of the same subject when they are hours apart", () => {
      const threads = [createThread("a")];
      const hour = 60 * 60 * 1000;
      const messages = [
        createMessage({threadId: "a", messageId: "<later>", subject: "Walk notes", sentAt: 3 * hour}),
        createMessage({threadId: "a", messageId: "<earlier>", subject: "Walk notes", sentAt: hour})
      ];
      const {totalCount} = sentMessageRows(threads, messages, 0, 50);
      expect(totalCount).toBe(2);
    });

    it("should apply offset and limit after ordering", () => {
      const threads = [createThread("a")];
      const messages = [
        createMessage({threadId: "a", messageId: "<m1>", subject: "one", sentAt: 400}),
        createMessage({threadId: "a", messageId: "<m2>", subject: "two", sentAt: 300}),
        createMessage({threadId: "a", messageId: "<m3>", subject: "three", sentAt: 200}),
        createMessage({threadId: "a", messageId: "<m4>", subject: "four", sentAt: 100})
      ];
      const {rows, totalCount} = sentMessageRows(threads, messages, 1, 2);
      expect(totalCount).toBe(4);
      expect(rows.map(row => row.sentMessageId)).toEqual(["<m2>", "<m3>"]);
    });
  });

  describe("isRecentSentCopy", () => {

    it("does not treat two different replies as copies because they share sender, subject and recipients", () => {
      const first = createMessage({
        subject: "Re: Walk notes",
        bodyText: "I can lead Saturday",
        sentAt: 1000
      });
      const second = createMessage({
        subject: "Re: Walk notes",
        bodyText: "I will bring the first-aid kit",
        sentAt: 60 * 1000
      });
      expect(isRecentSentCopy(first, second)).toBe(false);
    });

    it("treats a later IMAP copy as the same send when one body is still empty", () => {
      const smtp = createMessage({
        subject: "Re: Walk notes",
        bodyText: "I can lead Saturday",
        sentAt: 1000
      });
      const imapStub = createMessage({
        subject: "Re: Walk notes",
        bodyText: "",
        bodyHtml: "",
        sentAt: 1400
      });
      expect(isRecentSentCopy(smtp, imapStub)).toBe(true);
    });
  });

  describe("sentThreadObjectIds", () => {

    it("keeps 24-character hex ids and drops anything else", () => {
      const ids = sentThreadObjectIds(["6abb05d2d7a000b428ab045b", "not-an-id", "6abb05d2d7a000b428ab045b"]);
      expect(ids.map(id => String(id))).toEqual(["6abb05d2d7a000b428ab045b", "6abb05d2d7a000b428ab045b"]);
    });
  });
});
