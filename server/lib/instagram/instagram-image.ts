import crypto from "crypto";
import path from "path";
import { GetObjectCommand, S3 } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { ResolvedAlbumImage } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { RootFolder } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { objectBufferForKey, putBufferDirect } from "../aws/aws-controllers";
import { isAwsUploadErrorResponse } from "../aws/aws-utils";
import { prepareInstagramImage } from "./instagram-image-transform";
import { InstagramImageObjectStore } from "./instagram-image.model";

const INSTAGRAM_SOURCE_PATH = "/api/aws/s3/";
const INSTAGRAM_ASSET_FOLDER = `${RootFolder.socialPublishing}/instagram`;

function objectKeyFrom(imageUrl: string): string {
  const pathname = new URL(imageUrl).pathname;
  if (!pathname.startsWith(INSTAGRAM_SOURCE_PATH)) {
    throw new Error(`Instagram image URL is not an S3 album image: ${imageUrl}`);
  } else {
    return decodeURIComponent(pathname.slice(INSTAGRAM_SOURCE_PATH.length));
  }
}

const defaultImageStore: InstagramImageObjectStore = {
  getBuffer: objectBufferForKey,
  putJpeg: (rootFolder, fileName, body) => putBufferDirect(rootFolder, fileName, body, "image/jpeg")
};

export function instagramImageStoreFor(s3Client: S3, bucket: string): InstagramImageObjectStore {
  return {
    async getBuffer(key: string): Promise<Buffer> {
      const response: any = await s3Client.send(new GetObjectCommand({Bucket: bucket, Key: key}));
      if (Buffer.isBuffer(response.Body)) {
        return response.Body;
      } else if (response.Body?.transformToByteArray) {
        return Buffer.from(await response.Body.transformToByteArray());
      } else {
        return new Promise<Buffer>((resolve, reject) => {
          const chunks: Uint8Array[] = [];
          response.Body.on("data", (chunk: Buffer | Uint8Array | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : new Uint8Array(Buffer.from(chunk)));
          });
          response.Body.on("error", reject);
          response.Body.on("end", () => resolve(Buffer.concat(chunks)));
        });
      }
    },
    async putJpeg(rootFolder: string, fileName: string, body: Buffer) {
      const objectKey = `${rootFolder}/${path.basename(fileName)}`;
      try {
        const data = await new Upload({
          client: s3Client,
          params: {Bucket: bucket, Key: objectKey, Body: body, ContentType: "image/jpeg"}
        }).done();
        return {responseData: data, information: `Successfully uploaded buffer to ${bucket}/${objectKey}`};
      } catch (error) {
        return {responseData: error, error: `Failed to upload object to ${bucket}/${objectKey}`};
      }
    }
  };
}

async function prepareAlbumImage(image: ResolvedAlbumImage, imageStore: InstagramImageObjectStore): Promise<ResolvedAlbumImage> {
  const input = await imageStore.getBuffer(objectKeyFrom(image.url));
  const prepared = await prepareInstagramImage(input);
  let result = image;
  if (prepared.transformed) {
    const fileName = `${crypto.createHash("sha256").update(input.toString("base64")).digest("hex")}.jpg`;
    const uploaded = await imageStore.putJpeg(INSTAGRAM_ASSET_FOLDER, fileName, prepared.body);
    if (isAwsUploadErrorResponse(uploaded)) {
      throw new Error(uploaded.error);
    } else {
      const origin = new URL(image.url).origin;
      result = {...image, url: `${origin}${INSTAGRAM_SOURCE_PATH}${INSTAGRAM_ASSET_FOLDER}/${fileName}`};
    }
  }
  return result;
}

export async function prepareInstagramAlbumImages(
  images: ResolvedAlbumImage[],
  imageStore: InstagramImageObjectStore = defaultImageStore
): Promise<ResolvedAlbumImage[]> {
  return images.reduce(
    async (preparedImages, image) => [...await preparedImages, await prepareAlbumImage(image, imageStore)],
    Promise.resolve([] as ResolvedAlbumImage[])
  );
}
