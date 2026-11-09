import debug from "debug";
import { Brevo } from "@getbrevo/brevo";
import { isArray, isString, uniqBy } from "es-toolkit/compat";
import { escapeHtml, validEmail } from "../../../projects/ngx-ramblers/src/app/functions/strings";
import { UIDateFormat } from "../../../projects/ngx-ramblers/src/app/models/date-format.model";
import { dateTimeNow } from "../shared/dates";
import { AdminAlertRecipient, AdminAlertsConfiguration } from "../../../projects/ngx-ramblers/src/app/models/admin-alerts.model";
import { ConfigKey } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import { envConfig } from "../env-config/env-config";
import { systemConfig } from "../config/system-config";
import * as config from "../mongo/controllers/config";
import { brevoClient } from "../brevo/brevo-config";
import { scheduleBrevo } from "../brevo/common/rate-limiting";
import { assertSendAllowed } from "../brevo/send-permission";
import { SendPurpose } from "../../../projects/ngx-ramblers/src/app/models/mail.model";
const debugLog = debug(envConfig.logNamespace("admin-alerts"));
debugLog.enabled = true;

export interface AdminAlertEmailRequest {
  subject: string;
  htmlContent: string;
  category?: string;
}

export interface AdminIncidentEmail {
  title: string;
  intro: string;
  items: { label: string; value: string }[];
  message: string;
  details?: string | null;
  actionUrl?: string | null;
  actionLabel?: string;
  actionHint?: string;
  actionFooter?: string;
}

export function buildAdminIncidentHtml(incident: AdminIncidentEmail): string {
  const detectedAt = dateTimeNow().toFormat(UIDateFormat.DISPLAY_DATE_AND_TIME);
  const detailsBlock = incident.details
    ? `<h3>Details</h3><pre style="background-color:#fee2e2;padding:10px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(incident.details)}</pre>`
    : "";
  const actionLabel = incident.actionLabel || "Open admin";
  const actionHint = incident.actionHint || "the admin page";
  const actionFooter = incident.actionFooter || "for more.";
  const actionsBlock = incident.actionUrl
    ? `<p style="margin-top:1.25em;">
         <a href="${escapeHtml(incident.actionUrl)}" style="display:inline-block;background:#c05711;color:#fff;text-decoration:none;padding:10px 16px;border-radius:4px;font-weight:600;">
           ${escapeHtml(actionLabel)}
         </a>
       </p>
       <p style="color:#666;font-size:0.9em;">
         Or go to
         <a href="${escapeHtml(incident.actionUrl)}" style="color:#c05711;">${escapeHtml(actionHint)}</a>
         ${escapeHtml(actionFooter)}
       </p>`
    : `<p style="color:#666;font-size:0.9em;">Check ${escapeHtml(actionHint)} ${escapeHtml(actionFooter)}</p>`;
  const items = incident.items.map(item => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`).join("");
  return `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #dc2626;">${escapeHtml(incident.title)}</h2>
        <p>${escapeHtml(incident.intro)}</p>
        <ul>
          ${items}
          <li><strong>Detected:</strong> ${escapeHtml(detectedAt)} (Europe/London)</li>
        </ul>
        <p>${escapeHtml(incident.message)}</p>
        ${detailsBlock}
        ${actionsBlock}
      </body>
    </html>
  `;
}

export async function notifyAdminIncident(request: AdminIncidentEmail & { subject: string; category: string }): Promise<boolean> {
  return sendAdminAlertEmail({
    subject: request.subject,
    htmlContent: buildAdminIncidentHtml(request),
    category: request.category
  });
}

export function normalisedAlertRecipients(value: unknown): AdminAlertRecipient[] {
  const entries: Partial<AdminAlertRecipient>[] = isArray(value) ? value : [];
  return uniqBy(entries
    .map(entry => ({email: isString(entry?.email) ? entry.email.trim() : "", name: isString(entry?.name) ? entry.name.trim() : ""}))
    .filter(recipient => validEmail(recipient.email)), recipient => recipient.email.toLowerCase());
}

export async function configuredAdminAlertRecipients(): Promise<AdminAlertRecipient[]> {
  try {
    const document = await config.queryKey(ConfigKey.ADMIN_ALERTS);
    const value = document?.value as AdminAlertsConfiguration | null;
    return normalisedAlertRecipients(value?.recipients);
  } catch (error: any) {
    debugLog("Failed to load admin alert recipients:", error?.message || error);
    return [];
  }
}

export async function setAdminAlertRecipients(value: unknown): Promise<AdminAlertRecipient[]> {
  const recipients = normalisedAlertRecipients(value);
  await config.createOrUpdateKey(ConfigKey.ADMIN_ALERTS, {recipients} satisfies AdminAlertsConfiguration);
  return recipients;
}

async function adminAlertRecipients(): Promise<Brevo.SendTransacEmailRequest["to"]> {
  const recipients = await configuredAdminAlertRecipients();
  return recipients.map(recipient => recipient.name ? recipient : {email: recipient.email});
}

export async function sendAdminAlertEmail(request: AdminAlertEmailRequest): Promise<boolean> {
  const category = request.category || "general";
  try {
    const recipients = await adminAlertRecipients();
    if (!envConfig.production) {
      debugLog(`Skipping admin alert (${category}) - ${envConfig.env} server, alerts are only emailed from deployed environments: ${request.subject}`);
      return false;
    } else if (recipients.length === 0) {
      debugLog(`No admin alert emails configured - not emailing (${category}): ${request.subject}`);
      return false;
    } else {
      await assertSendAllowed(SendPurpose.ADMIN_ALERT, {subject: request.subject, recipientCount: recipients.length});
      const client = await brevoClient();
      const sendSmtpEmail: Brevo.SendTransacEmailRequest = {
        subject: request.subject,
        sender: {email: "backup@ngx-ramblers.org.uk", name: "NGX-Ramblers Alerts"},
        to: recipients,
        htmlContent: request.htmlContent
      };
      await scheduleBrevo(() => client.transactionalEmails.sendTransacEmail(sendSmtpEmail));
      debugLog(`Admin alert emailed to ${recipients.map(recipient => recipient.email).join(", ")} (${category}): ${request.subject}`);
      return true;
    }
  } catch (error: any) {
    debugLog(`Failed to email admin alert (${category}):`, error?.message || error);
    return false;
  }
}
