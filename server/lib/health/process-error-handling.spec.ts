import expect from "expect";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { Request, Response } from "express";
import * as adminAlerts from "../alerts/admin-alerts";
import * as siteBaseUrlModule from "../config/site-base-url";
import {
  processErrorDetails,
  processErrorMessage,
  productionRequestErrorHandler,
  shouldSendProcessErrorAlert
} from "./process-error-handling";

describe("process error handling", () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it("formats Error messages and details", () => {
    const error = new Error("boom");
    expect(processErrorMessage(error)).toEqual("boom");
    expect(processErrorDetails(error)).toContain("Error");
    expect(processErrorDetails(error)).toContain("boom");
  });

  it("formats non-Error values", () => {
    expect(processErrorMessage("nope")).toEqual("nope");
    expect(processErrorDetails(42)).toEqual("42");
  });

  it("throttles process error alerts within the window", () => {
    expect(shouldSendProcessErrorAlert(1000, 0, 500)).toEqual(true);
    expect(shouldSendProcessErrorAlert(400, 0, 500)).toEqual(false);
    expect(shouldSendProcessErrorAlert(500, 0, 500)).toEqual(true);
  });

  it("returns JSON 500 for API requests when headers are not sent", () => {
    sandbox.stub(siteBaseUrlModule, "siteBaseUrl").resolves("https://group.example.org.uk");
    sandbox.stub(adminAlerts, "notifyAdminIncident").resolves(true);
    const json = sandbox.stub();
    const status = sandbox.stub().returns({json, send: sandbox.stub()});
    const res = {headersSent: false, status} as unknown as Response;
    const req = {method: "POST", path: "/api/database/auth/login"} as Request;
    productionRequestErrorHandler(new Error("boom"), req, res, sandbox.stub());
    expect(status.calledWith(500)).toEqual(true);
    expect(json.calledOnce).toEqual(true);
    expect(json.firstCall.args[0]).toEqual({error: {message: "The site hit an unexpected error. Try again."}});
  });

  it("delegates a partial response to the Express error handler", () => {
    sandbox.stub(siteBaseUrlModule, "siteBaseUrl").resolves("https://group.example.org.uk");
    sandbox.stub(adminAlerts, "notifyAdminIncident").resolves(true);
    const status = sandbox.stub();
    const res = {headersSent: true, status} as unknown as Response;
    const req = {method: "GET", path: "/walks"} as Request;
    const error = new Error("boom");
    const next = sandbox.stub();
    productionRequestErrorHandler(error, req, res, next);
    expect(next.calledOnceWithExactly(error)).toBe(true);
    expect(status.called).toEqual(false);
  });
});
