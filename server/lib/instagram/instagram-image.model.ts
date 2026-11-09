import { AwsInfo, AwsUploadErrorResponse } from "../../../projects/ngx-ramblers/src/app/models/aws-object.model";

export interface InstagramImageResult {
  body: Buffer;
  transformed: boolean;
}

export interface InstagramImageObjectStore {
  getBuffer(key: string): Promise<Buffer>;
  putJpeg(rootFolder: string, fileName: string, body: Buffer): Promise<AwsInfo | AwsUploadErrorResponse>;
}
