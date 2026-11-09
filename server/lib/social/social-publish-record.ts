import { SocialPublishResult } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";
import { socialPublication } from "../mongo/models/social-publication";
import { dateTimeNowAsValue } from "../shared/dates";
import { IntegrationWorkerSocialPublishNetworkImages } from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";

export async function recordSocialPublication(
  albumName: string,
  result: SocialPublishResult,
  imageNames: string[],
  caption: string
): Promise<void> {
  if (result.success) {
    await socialPublication.create({
      albumName,
      network: result.network,
      postId: result.postId,
      permalink: result.permalink,
      imageCount: result.imageCount,
      imageNames,
      caption,
      publishedAt: dateTimeNowAsValue()
    });
  }
}

export async function recordSocialPublications(
  albumName: string,
  results: SocialPublishResult[],
  networks: IntegrationWorkerSocialPublishNetworkImages[]
): Promise<void> {
  await Promise.all(results.map(result => {
    const networkWork = networks.find(item => item.network === result.network);
    return recordSocialPublication(albumName, result, networkWork?.imageNames || [], networkWork?.caption || "");
  }));
}
