import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { Facebook, Instagram } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import {
  SocialNetwork,
  SocialProgressCallback,
  SocialPublishResult
} from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { IntegrationWorkerSocialPublishNetworkImages } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { publishAlbumToFacebook } from "../facebook/facebook-publish";
import { publishAlbumToInstagram } from "../instagram/instagram-publish";
import { InstagramImageObjectStore } from "../instagram/instagram-image.model";

const debugLog = debug(envConfig.logNamespace("social:publish-album-run"));
debugLog.enabled = true;

export async function publishSocialAlbumNetworks(work: {
  facebook: Facebook;
  instagram: Instagram;
  accessToken: string;
  networks: IntegrationWorkerSocialPublishNetworkImages[];
  imageStore?: InstagramImageObjectStore;
  onProgress?: SocialProgressCallback;
}): Promise<SocialPublishResult[]> {
  const results: SocialPublishResult[] = [];
  for (const networkWork of work.networks) {
    try {
      const result = networkWork.network === SocialNetwork.FACEBOOK
        ? await publishAlbumToFacebook(work.facebook, networkWork.images, networkWork.caption, work.onProgress)
        : await publishAlbumToInstagram(
          work.instagram,
          work.accessToken,
          networkWork.images,
          networkWork.caption,
          work.onProgress,
          work.imageStore || null
        );
      results.push(result);
    } catch (error) {
      debugLog(networkWork.network, "publish failed:", error);
      results.push({network: networkWork.network, success: false, error: error?.message || String(error)});
    }
  }
  return results;
}
