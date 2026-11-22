import { describe, it } from "mocha";
import expect from "expect";
import { configValueForRequester, restoreSensitiveFields } from "./config";
import { ConfigKey } from "../../../../projects/ngx-ramblers/src/app/models/config.model";

function systemValue() {
  return {
    national: {
      walksManager: {
        href: "https://walks-manager.ramblers.org.uk/walks-manager",
        userName: "walks-secretary",
        password: "hunter2",
        apiKey: "read-key"
      }
    },
    externalSystems: {
      meetup: {clientId: "meetup-client", clientSecret: "meetup-secret", accessToken: "meetup-access", refreshToken: "meetup-refresh"},
      facebook: {appId: "fb-app", appSecret: "fb-secret", pageAccessToken: "fb-page-token"}
    },
    recaptcha: {siteKey: "public-site-key", secretKey: "recaptcha-secret"},
    inboxPush: {vapidPublicKey: "public-push-key", vapidPrivateKey: "private-push-key"},
    mail: {smtpPassword: "smtp-secret", smtpPasswordSecondary: "smtp-secret-2"}
  };
}

describe("configValueForRequester", () => {
  it("masks every sensitive value for a non-admin", () => {
    const result = configValueForRequester(ConfigKey.SYSTEM, systemValue(), false);
    expect(result.national.walksManager).toEqual({
      href: "https://walks-manager.ramblers.org.uk/walks-manager",
      userName: "***",
      password: "***",
      apiKey: "***"
    });
  });

  it("never returns secrets to an admin but keeps identifiers and public keys readable", () => {
    const result = configValueForRequester(ConfigKey.SYSTEM, systemValue(), true);
    expect(result.national.walksManager).toEqual({
      href: "https://walks-manager.ramblers.org.uk/walks-manager",
      userName: "walks-secretary",
      password: "***",
      apiKey: "***"
    });
    expect(result.externalSystems.meetup).toEqual({clientId: "meetup-client", clientSecret: "***", accessToken: "***", refreshToken: "***"});
    expect(result.externalSystems.facebook).toEqual({appId: "fb-app", appSecret: "***", pageAccessToken: "***"});
    expect(result.recaptcha).toEqual({siteKey: "public-site-key", secretKey: "***"});
    expect(result.inboxPush).toEqual({vapidPublicKey: "public-push-key", vapidPrivateKey: "***"});
    expect(result.mail).toEqual({smtpPassword: "***", smtpPasswordSecondary: "***"});
  });

  it("masks the Brevo and Mailchimp API keys for an admin", () => {
    expect(configValueForRequester(ConfigKey.MAIL, {apiKey: "xkeysib-1", baseUrl: "https://app.brevo.com"}, true))
      .toEqual({apiKey: "***", baseUrl: "https://app.brevo.com"});
    expect(configValueForRequester(ConfigKey.MAILCHIMP, {apiKey: "mc-1"}, true)).toEqual({apiKey: "***"});
  });

  it("masks each Team Emails API key but keeps the group codes so the settings page can list them", () => {
    const value = {endpointBaseUrl: "https://api.example.org", apiKeysByGroupCode: {KT50: "key-a", KT51: ""}, enabled: true};
    expect(configValueForRequester(ConfigKey.SALESFORCE, value, true))
      .toEqual({endpointBaseUrl: "https://api.example.org", apiKeysByGroupCode: {KT50: "***", KT51: null}, enabled: true});
  });

  it("leaves an unset secret empty so the settings page shows it needs filling in", () => {
    const value = systemValue();
    value.national.walksManager.password = "";
    const result = configValueForRequester(ConfigKey.SYSTEM, value, true);
    expect(result.national.walksManager.password).toBeNull();
  });

  it("returns environment management values unchanged to an admin", () => {
    const value = {environments: [{environment: "x", mongo: {password: "p"}}]};
    expect(configValueForRequester(ConfigKey.ENVIRONMENTS, value, true)).toEqual(value);
  });
});

describe("restoreSensitiveFields", () => {
  it("keeps the stored secret when the browser sends the mask back", () => {
    const stored = systemValue();
    const incoming = configValueForRequester(ConfigKey.SYSTEM, stored, true);
    expect(restoreSensitiveFields(stored, incoming)).toEqual(stored);
  });

  it("saves a newly typed secret", () => {
    const incoming = {...configValueForRequester(ConfigKey.MAIL, {apiKey: "old"}, true), apiKey: "new"};
    expect(restoreSensitiveFields({apiKey: "old"}, incoming)).toEqual({apiKey: "new"});
  });

  it("keeps masked Team Emails keys, saves changed ones and adds new group codes", () => {
    const stored = {apiKeysByGroupCode: {KT50: "key-a", KT51: "key-b"}};
    const incoming = {apiKeysByGroupCode: {KT50: "***", KT51: "key-b2", KT52: "key-c"}};
    expect(restoreSensitiveFields(stored, incoming)).toEqual({apiKeysByGroupCode: {KT50: "key-a", KT51: "key-b2", KT52: "key-c"}});
  });

  it("does not add settings the browser left out", () => {
    expect(restoreSensitiveFields({baseUrl: "a", editorUrl: "b"}, {baseUrl: "c"})).toEqual({baseUrl: "c"});
  });
});
