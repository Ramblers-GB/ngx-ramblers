import debug from "debug";
import { envConfig } from "../../env-config/env-config";
import { dateTimeNowAsValue } from "../../shared/dates";
import { brevoBounceDiagnostic } from "../../mongo/models/brevo-bounce-diagnostic";
import { BrevoBounceDiagnostic } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
import { diagnosticFromWebhookPayload } from "../../../../projects/ngx-ramblers/src/app/functions/brevo-bounce-diagnostics";
import { normaliseEmail } from "../../../../projects/ngx-ramblers/src/app/functions/strings";

const debugLog = debug(envConfig.logNamespace("brevo:bounce-diagnostics"));
debugLog.enabled = false;

export async function persistBounceDiagnostic(payload: Record<string, unknown>, memberId?: string): Promise<BrevoBounceDiagnostic | null> {
  const receivedAt = dateTimeNowAsValue();
  const diagnostic = diagnosticFromWebhookPayload(payload, memberId, receivedAt);
  if (!diagnostic) {
    return null;
  } else {
    try {
      await brevoBounceDiagnostic.updateOne(
        {eventKey: diagnostic.eventKey},
        {
          $set: {
            email: diagnostic.email,
            memberId: diagnostic.memberId,
            providerEvent: diagnostic.providerEvent,
            event: diagnostic.event,
            reason: diagnostic.reason,
            sendingIp: diagnostic.sendingIp,
            campaignId: diagnostic.campaignId,
            messageId: diagnostic.messageId,
            eventAt: diagnostic.eventAt,
            receivedAt
          }
        },
        {upsert: true}
      );
      return diagnostic;
    } catch (error: any) {
      debugLog("persistBounceDiagnostic:failed", diagnostic.eventKey, error?.message || error);
      return diagnostic;
    }
  }
}

export async function diagnosticsForEmail(email: string): Promise<BrevoBounceDiagnostic[]> {
  const normalised = normaliseEmail(email);
  if (!normalised) {
    return [];
  } else {
    try {
      const rows = await brevoBounceDiagnostic.find({email: normalised}).sort({eventAt: -1}).lean().exec();
      return rows as BrevoBounceDiagnostic[];
    } catch (error: any) {
      debugLog("diagnosticsForEmail:failed", normalised, error?.message || error);
      return [];
    }
  }
}
