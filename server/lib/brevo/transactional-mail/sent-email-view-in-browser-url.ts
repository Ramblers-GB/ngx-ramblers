import debug from "debug";
import { envConfig } from "../../env-config/env-config";
import { brevoClient } from "../brevo-config";
import { scheduleBrevo } from "../common/rate-limiting";
import { viewInBrowserUrlFromDeliveredHtml } from "../../../../projects/ngx-ramblers/src/app/functions/email-merge-field-urls";

const debugLog = debug(envConfig.logNamespace("brevo:sent-email-view-in-browser-url"));
debugLog.enabled = false;

export async function viewInBrowserUrlForSentEmail(messageId: string, sentHtml: string): Promise<string | null> {
  try {
    const client = await brevoClient();
    const sends = await scheduleBrevo(() => client.transactionalEmails.getTransacEmailsList({messageId, limit: 1}));
    const uuid = sends?.transactionalEmails?.[0]?.uuid;
    if (!uuid) {
      return null;
    } else {
      const content = await scheduleBrevo(() => client.transactionalEmails.getTransacEmailContent({uuid}));
      return viewInBrowserUrlFromDeliveredHtml(sentHtml, content?.body ?? "");
    }
  } catch (error) {
    debugLog("view in browser lookup failed for", messageId, (error as Error).message);
    return null;
  }
}
