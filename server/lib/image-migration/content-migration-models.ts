import { Connection, Model } from "mongoose";
import { modelOnConnection } from "../mongo/utils/model-utils";
import { contentMetadata, contentMetadataSchema } from "../mongo/models/content-metadata";
import { pageContent, pageContentSchema } from "../mongo/models/page-content";
import { extendedGroupEvent, extendedGroupEventSchema } from "../mongo/models/extended-group-event";
import committeeFile, { committeeFileSchema } from "../mongo/models/committee-file";
import { ContentMetadata } from "../../../projects/ngx-ramblers/src/app/models/content-metadata.model";
import { PageContent } from "../../../projects/ngx-ramblers/src/app/models/content-text.model";
import { ExtendedGroupEvent } from "../../../projects/ngx-ramblers/src/app/models/group-event.model";

export interface ContentMigrationModels {
  contentMetadata: Model<ContentMetadata>;
  pageContent: Model<PageContent>;
  extendedGroupEvent: Model<ExtendedGroupEvent>;
  committeeFile: Model<any>;
}

export function defaultContentMigrationModels(): ContentMigrationModels {
  return { contentMetadata, pageContent, extendedGroupEvent, committeeFile };
}

export function contentMigrationModelsFor(connection: Connection): ContentMigrationModels {
  return {
    contentMetadata: modelOnConnection(connection, contentMetadata.modelName, contentMetadataSchema),
    pageContent: modelOnConnection(connection, pageContent.modelName, pageContentSchema),
    extendedGroupEvent: modelOnConnection(connection, extendedGroupEvent.modelName, extendedGroupEventSchema),
    committeeFile: modelOnConnection(connection, committeeFile.modelName, committeeFileSchema)
  };
}
