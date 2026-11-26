import expect from "expect";
import AdmZip from "adm-zip";
import { describe, it } from "mocha";
import { contributorBundleFileName, contributorBundleZip } from "./contributor-bundle";

describe("contributorBundleZip", () => {
  it("packs the secrets file, manifest and README for one group", () => {
    const zip = new AdmZip(contributorBundleZip({
      environment: "hillside",
      appName: "ngx-ramblers-hillside",
      mongoUri: "mongodb+srv://ngx_contrib_hillside_dev:clone-password@cluster0.example.mongodb.net/ngx-ramblers-hillside-dev",
      aws: {region: "eu-west-2", bucket: "ngx-ramblers-hillside", accessKeyId: "read-key", secretAccessKey: "read-secret"}
    }));
    expect(zip.getEntries().map(entry => entry.entryName).sort()).toEqual([
      "README-contributor-environment.txt",
      "non-vcs/secrets/environments.local.json",
      "non-vcs/secrets/secrets.ngx-ramblers-hillside.env"
    ]);
    const secrets = zip.readAsText("non-vcs/secrets/secrets.ngx-ramblers-hillside.env");
    expect(secrets).toContain("ngx_contrib_hillside_dev");
    expect(secrets).toContain("read-key");
    expect(zip.readAsText("README-contributor-environment.txt")).toContain(".nvmrc");
  });

  it("names the download after the environment", () => {
    expect(contributorBundleFileName("hillside")).toEqual("contributor-environment-hillside.zip");
  });
});
