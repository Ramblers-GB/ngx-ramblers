import expect from "expect";
import { describe, it } from "mocha";
import { classifyMissingRequiredSecrets, REQUIRED_SECRETS } from "./secrets";

function allRequiredSecrets(): Record<string, string> {
  return REQUIRED_SECRETS.reduce((accumulator, key) => ({ ...accumulator, [key]: `value-${key}` }), {});
}

describe("classifyMissingRequiredSecrets", () => {

  it("reports nothing missing when every required secret is present", () => {
    const result = classifyMissingRequiredSecrets(allRequiredSecrets());
    expect(result).toEqual({ missing: [], autoGeneratable: [], unrecoverable: [] });
  });

  it("classifies a missing AUTH_SECRET as auto-generatable", () => {
    const secrets = allRequiredSecrets();
    delete secrets.AUTH_SECRET;
    const result = classifyMissingRequiredSecrets(secrets);
    expect(result.missing).toEqual(["AUTH_SECRET"]);
    expect(result.autoGeneratable).toEqual(["AUTH_SECRET"]);
    expect(result.unrecoverable).toEqual([]);
  });

  it("classifies a missing NODE_ENV as auto-generatable from its static default", () => {
    const secrets = allRequiredSecrets();
    delete secrets.NODE_ENV;
    const result = classifyMissingRequiredSecrets(secrets);
    expect(result.missing).toEqual(["NODE_ENV"]);
    expect(result.autoGeneratable).toEqual(["NODE_ENV"]);
    expect(result.unrecoverable).toEqual([]);
  });

  it("classifies a missing AWS credential as unrecoverable", () => {
    const secrets = allRequiredSecrets();
    delete secrets.AWS_BUCKET;
    const result = classifyMissingRequiredSecrets(secrets);
    expect(result.missing).toEqual(["AWS_BUCKET"]);
    expect(result.autoGeneratable).toEqual([]);
    expect(result.unrecoverable).toEqual(["AWS_BUCKET"]);
  });

  it("separates auto-generatable from unrecoverable when both are missing", () => {
    const secrets = allRequiredSecrets();
    delete secrets.AUTH_SECRET;
    delete secrets.MONGODB_URI;
    const result = classifyMissingRequiredSecrets(secrets);
    expect(result.autoGeneratable).toEqual(["AUTH_SECRET"]);
    expect(result.unrecoverable).toEqual(["MONGODB_URI"]);
  });

  it("treats an empty bundle as every required secret missing", () => {
    const result = classifyMissingRequiredSecrets({});
    expect(result.missing).toEqual(REQUIRED_SECRETS);
    expect(result.autoGeneratable).toEqual(["AUTH_SECRET", "NODE_ENV"]);
  });

});

describe("migration encryption key preservation", () => {
  it("stops before reading or changing configuration when the source key cannot be recovered", async () => {
    const sinon = await import("sinon");
    const fly = await import("../fly/fly-secrets");
    const environments = await import("../environments/environments-config");
    const {resolveSecretsForMigration} = await import("./secrets");
    const sandbox = sinon.createSandbox();
    const source = sandbox.stub(fly, "pullAllSecretsFromFly").returns({});
    const persist = sandbox.stub(environments, "persistEnvironmentSecret").resolves();
    try {
      await expect(resolveSecretsForMigration("fictional-group", "fictional-app", "fictional-token")).rejects.toThrow("will not generate or substitute an encryption key");
      expect(source.calledOnce).toBe(true);
      expect(persist.called).toBe(false);
    } finally {
      sandbox.restore();
    }
  });
});

it("preserves the running source encryption key and native mail TLS mode over stale saved settings", async () => {
  const sinon = await import("sinon");
  const fly = await import("../fly/fly-secrets");
  const environments = await import("../environments/environments-config");
  const {resolveSecretsForMigration} = await import("./secrets");
  const sandbox = sinon.createSandbox();
  sandbox.stub(fly, "pullAllSecretsFromFly").returns({AUTH_SECRET: "original-encryption-key", MAIL_CLIENT_NATIVE_TLS: "true"});
  sandbox.stub(environments, "environmentsConfigFromDatabase").resolves({environments: [{environment: "fictional-group", secrets: {...allRequiredSecrets(), MAIL_CLIENT_NATIVE_TLS: "false"}}]} as any);
  const persist = sandbox.stub(environments, "persistEnvironmentSecret").resolves();
  try {
    const resolved = await resolveSecretsForMigration("fictional-group", "fictional-app", "fictional-token");
    expect(resolved.AUTH_SECRET).toBe("original-encryption-key");
    expect(resolved.MAIL_CLIENT_NATIVE_TLS).toBe("true");
    expect(persist.calledWithExactly("fictional-group", "AUTH_SECRET", "original-encryption-key")).toBe(true);
    expect(persist.calledWithExactly("fictional-group", "MAIL_CLIENT_NATIVE_TLS", "true")).toBe(true);
  } finally {
    sandbox.restore();
  }
});
