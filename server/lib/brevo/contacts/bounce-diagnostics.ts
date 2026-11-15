import debug from "debug";
import { envConfig } from "../../env-config/env-config";
import { dateTimeNowAsValue } from "../../shared/dates";
import { brevoBounceDiagnostic } from "../../mongo/models/brevo-bounce-diagnostic";
import {
  BlockedContact,
  BrevoBounceDiagnostic,
  BrevoEventType
} from "../../../../projects/ngx-ramblers/src/app/models/mail.model";
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
  return diagnosticsForEmails([email]);
}

export async function diagnosticsForEmails(emails: string[]): Promise<BrevoBounceDiagnostic[]> {
  const normalised = [...new Set(emails.map(email => normaliseEmail(email)).filter(Boolean))];
  if (normalised.length === 0) {
    return [];
  } else {
    try {
      const rows = await brevoBounceDiagnostic.find({email: {$in: normalised}}).sort({eventAt: -1}).lean().exec();
      return rows as BrevoBounceDiagnostic[];
    } catch (error: any) {
      debugLog("diagnosticsForEmails:failed", normalised.length, error?.message || error);
      return [];
    }
  }
}

export async function diagnosticsBetween(fromMs: number, toMs: number, event?: BrevoEventType): Promise<BrevoBounceDiagnostic[]> {
  const filter: Record<string, unknown> = {eventAt: {$gte: fromMs, $lte: toMs}};
  if (event) {
    filter.event = event;
  }
  try {
    const rows = await brevoBounceDiagnostic.find(filter).sort({eventAt: -1}).limit(200).lean().exec();
    return rows as BrevoBounceDiagnostic[];
  } catch (error: any) {
    debugLog("diagnosticsBetween:failed", error?.message || error);
    return [];
  }
}

export async function attachBounceDiagnosticsToBlockedContacts(contacts: BlockedContact[]): Promise<BlockedContact[]> {
  const diagnostics = await diagnosticsForEmails(contacts.map(contact => contact.email));
  const latestByEmail = new Map<string, BrevoBounceDiagnostic>();
  diagnostics.forEach(diagnostic => {
    if (!latestByEmail.has(diagnostic.email)) {
      latestByEmail.set(diagnostic.email, diagnostic);
    }
  });
  return contacts.map(contact => {
    const diagnostic = latestByEmail.get(normaliseEmail(contact.email) || "");
    if (!diagnostic?.reason || contact.reason?.message) {
      return contact;
    } else {
      return {
        ...contact,
        reason: {
          ...contact.reason,
          message: diagnostic.reason
        }
      };
    }
  });
}
