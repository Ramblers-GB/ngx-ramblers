import { Brevo, BrevoClient, BrevoError } from "@getbrevo/brevo";
import { scheduleBrevo } from "./common/rate-limiting";
import crypto from "crypto";
import debug from "debug";
import { ConfigKey, ConfigDocument } from "../../../projects/ngx-ramblers/src/app/models/config.model";
import { MailConfig } from "../../../projects/ngx-ramblers/src/app/models/mail.model";
import { envConfig } from "../env-config/env-config";
import * as config from "../mongo/controllers/config";
import { systemConfig } from "../config/system-config";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";

const debugLog = debug(envConfig.logNamespace("brevo:events-webhook-config"));
debugLog.enabled = true;

export interface BrevoEventsWebhookConfig {
  webhookUrl: string;
  secret: string;
}

function newSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function deriveWebhookUrl(secret: string): Promise<string> {
  const sys = await systemConfig();
  const base = stripTrailingSlash(sys?.group?.href);
  if (!base) {
    throw new Error("System config group.href not set; cannot derive webhook URL");
  }
  return `${base}/api/mail/webhooks/brevo-events?token=${secret}`;
}

export async function ensureBrevoEventsWebhookConfigured(): Promise<BrevoEventsWebhookConfig> {
  const doc = await config.queryKey(ConfigKey.BREVO) as ConfigDocument;
  const value: MailConfig = doc.value;
  if (value.brevoEventsWebhookSecret) {
    const webhookUrl = await deriveWebhookUrl(value.brevoEventsWebhookSecret);
    debugLog("Brevo events webhook already configured");
    return { webhookUrl, secret: value.brevoEventsWebhookSecret };
  }
  const secret = newSecret();
  value.brevoEventsWebhookSecret = secret;
  await config.createOrUpdateKey(ConfigKey.BREVO, value);
  const webhookUrl = await deriveWebhookUrl(secret);
  debugLog("Generated new Brevo events webhook secret and saved to Brevo config");
  return { webhookUrl, secret };
}

export async function readBrevoEventsWebhookSecret(): Promise<string | undefined> {
  const doc = await config.queryKey(ConfigKey.BREVO) as ConfigDocument;
  const value: MailConfig = doc.value;
  return value?.brevoEventsWebhookSecret;
}

const marketingBounceEvents = [
  Brevo.CreateWebhookRequest.Events.Item.HardBounce,
  Brevo.CreateWebhookRequest.Events.Item.SoftBounce
];

const marketingWebhookSetup = {pending: null as Promise<void> | null};

async function configureMarketingBounceWebhook(client: BrevoClient): Promise<void> {
  try {
    const {webhookUrl} = await ensureBrevoEventsWebhookConfigured();
    const webhooks = await scheduleBrevo(() => client.webhooks.getWebhooks({type: "marketing"}))
      .then(result => result.webhooks ?? [])
      .catch(error => {
        if (error instanceof BrevoError && error.statusCode === 400 && (error.body as {code?: string})?.code === "document_not_found") {
          return [];
        } else {
          throw error;
        }
      });
    const webhook = webhooks.find(item => item.url === webhookUrl && !item.batched && item.channel !== "sms");
    const existingEvents = new Set(webhooks
      .filter(item => item.url === webhookUrl && !item.batched && item.channel !== "sms")
      .flatMap(item => item.events));
    const missingEvents = marketingBounceEvents.filter(event => !existingEvents.has(event));
    if (missingEvents.length && webhook) {
      await scheduleBrevo(() => client.webhooks.updateWebhook({
        webhookId: webhook.id,
        events: [...new Set([...webhook.events, ...missingEvents])] as Brevo.UpdateWebhookRequest.Events
      }));
    } else if (missingEvents.length) {
      await scheduleBrevo(() => client.webhooks.createWebhook({
        url: webhookUrl,
        type: "marketing",
        channel: "email",
        description: "NGX Ramblers campaign bounce diagnostics",
        events: marketingBounceEvents
      }));
    }
  } catch (error) {
    debugLog("Campaign bounce webhook setup failed", error instanceof BrevoError ? error.statusCode : (error as Error)?.name);
    throw new Error("Could not configure Brevo campaign bounce reporting. Try again before sending.");
  }
}

export function ensureBrevoMarketingBounceWebhook(client: BrevoClient): Promise<void> {
  marketingWebhookSetup.pending ??= configureMarketingBounceWebhook(client).finally(() => {
    marketingWebhookSetup.pending = null;
  });
  return marketingWebhookSetup.pending;
}
