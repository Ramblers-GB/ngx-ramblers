import { SocialPublishResult } from "../../../projects/ngx-ramblers/src/app/models/social-publish.model";

export function socialPublishFailureCount(results: SocialPublishResult[]): number {
  return results.filter(result => !result.success).length;
}

export function socialPublishSuccessCount(results: SocialPublishResult[]): number {
  return results.filter(result => result.success).length;
}

export function socialPublishCompleteMessage(results: SocialPublishResult[]): string {
  const successCount = socialPublishSuccessCount(results);
  const failureCount = socialPublishFailureCount(results);
  let message = "Publish failed for all selected networks";
  if (successCount === 0 && failureCount === 1) {
    message = results[0]?.error || "Publish failed";
  } else if (successCount > 0 && failureCount === 0) {
    message = successCount === 1
      ? `Published to ${results.find(result => result.success)?.network}`
      : `Published to ${successCount} networks`;
  } else if (successCount > 0) {
    message = `Published to ${successCount} of ${results.length} networks`;
  }
  return message;
}

export function socialPublishFailed(results: SocialPublishResult[]): boolean {
  return socialPublishSuccessCount(results) === 0;
}
