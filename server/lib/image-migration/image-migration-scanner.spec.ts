import expect from "expect";
import { ContentMigrationDocumentType } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { documentTypeFromUrl, fileNameFromUrl } from "./image-migration-scanner";

describe("fileNameFromUrl", () => {
  it("uses the file query on Event Gallery image.php URLs", () => {
    expect(fileNameFromUrl("https://group.example.org.uk/components/com_eventgallery/helpers/image.php?width=1600&folder=Broomway2026&file=WhatsApp+Image+2026-07-26+at+21.10.+3.jpeg"))
      .toEqual("WhatsApp Image 2026-07-26 at 21.10. 3.jpeg");
  });

  it("uses a camera filename on Event Gallery image.php URLs", () => {
    expect(fileNameFromUrl("https://group.example.org.uk/components/com_eventgallery/helpers/image.php?width=1600&folder=StPeter%27sWay&file=20210803_115942.jpg"))
      .toEqual("20210803_115942.jpg");
  });

  it("uses the path segment when there is no file query", () => {
    expect(fileNameFromUrl("https://group.example.org.uk/images/walks/banner.jpeg")).toEqual("banner.jpeg");
  });
});

describe("documentTypeFromUrl", () => {
  it("treats Event Gallery image.php URLs as images", () => {
    expect(documentTypeFromUrl("https://group.example.org.uk/components/com_eventgallery/helpers/image.php?width=1600&folder=Broomway2026&file=a.jpeg"))
      .toEqual(ContentMigrationDocumentType.IMAGE);
  });
});
