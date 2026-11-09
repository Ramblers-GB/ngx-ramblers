import expect from "expect";
import { ansiHtml, SYSTEM_LOG_LIMIT, stripAnsi } from "../../../projects/ngx-ramblers/src/app/models/system-log.model";
import { appendSystemLog, clearSystemLogs, systemLogSnapshot } from "./system-log-buffer";

describe("system-log-buffer", () => {

  beforeEach(() => {
    clearSystemLogs();
  });

  it("stores prefix without the ngx-ramblers environment", () => {
    appendSystemLog("ngx-ramblers:development:mail-client:imap", "LOGIN completed");
    expect(systemLogSnapshot()[0].prefix).toEqual("mail-client:imap");
    expect(systemLogSnapshot()[0].text).toEqual("LOGIN completed");
  });

  it("keeps the most recent lines up to the limit", () => {
    [...Array(SYSTEM_LOG_LIMIT + 3)].forEach((_value, index) => {
      appendSystemLog("ngx-ramblers:test:server", `line ${index}`);
    });
    const snapshot = systemLogSnapshot();
    expect(snapshot.length).toEqual(SYSTEM_LOG_LIMIT);
    expect(snapshot[0].text).toEqual("line 3");
    expect(snapshot[snapshot.length - 1].text).toEqual(`line ${SYSTEM_LOG_LIMIT + 2}`);
  });

  it("strips ANSI colour sequences from log text", () => {
    const raw = "\u001B[33;1mngx-ramblers:production:websocket-server \u001B[0m✅ Client connected \u001B[33m+1ms\u001B[0m";
    expect(stripAnsi(raw)).toEqual("ngx-ramblers:production:websocket-server ✅ Client connected +1ms");
  });

  it("turns ANSI colour sequences into HTML spans", () => {
    const raw = "\u001B[32mGET /api/health 200\u001B[0m";
    expect(ansiHtml(raw)).toEqual("<span style=\"color:#4ade80\">GET /api/health 200</span>");
  });
});
