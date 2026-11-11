import expect from "expect";
import { once } from "events";
import { createServer } from "http";
import { AddressInfo } from "net";
import sinon from "sinon";
import {
  ContentMigrationDocumentType,
  ContentMigrationProgress,
  ContentMigrationSourceType,
  ContentMigrationStatus,
  ExternalContentReference,
  RootFolder
} from "../../../projects/ngx-ramblers/src/app/models/system.model";
import * as publicSiteFetch from "../site-registration/public-site-fetch";
import { migrateContent } from "./image-migration-engine";

describe("Content Migration redirects", () => {
  it("follows a relative redirect and reports a malformed redirect as an item failure", async () => {
    const requestedPaths: string[] = [];
    const server = createServer((request, response) => {
      requestedPaths.push(request.url);
      response.writeHead(302, {Location: request.url === "/start.png" ? "/next.png" : "http://["});
      response.end("Redirect");
    });
    const publicHost = sinon.stub(publicSiteFetch, "assertPublicInternetHost").resolves([{address: "127.0.0.1", family: 4}]);

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      const currentUrl = `http://example.test:${port}/start.png`;
      const item: ExternalContentReference = {
        id: "example-image",
        sourceType: ContentMigrationSourceType.PAGE_CONTENT,
        sourceId: "example-page",
        sourcePath: "example",
        sourceTitle: "Example page",
        currentUrl,
        thumbnailUrl: currentUrl,
        documentType: ContentMigrationDocumentType.IMAGE,
        fileSize: null,
        status: ContentMigrationStatus.PENDING,
        selected: true,
        newS3Url: null,
        errorMessage: null
      };
      const progress: ContentMigrationProgress[] = [];
      const result = await migrateContent({items: [item], targetRootFolder: RootFolder.siteContent}, update => progress.push(update));

      expect(requestedPaths).toEqual(["/start.png", "/next.png"]);
      expect(publicHost.args).toEqual([["example.test"], ["example.test"]]);
      expect(progress.some(update => update.errorMessage === "Invalid URL")).toBe(true);
      expect(result.failureCount).toBe(1);
      expect(result.failedItems[0].status).toBe(ContentMigrationStatus.FAILED);
    } finally {
      publicHost.restore();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
