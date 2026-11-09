import debug from "debug";
import { envConfig } from "../env-config/env-config";
import { Environment } from "../../../projects/ngx-ramblers/src/app/models/environment.model";
import { Ai } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { AiConnectionStatus, CoverImageCandidate } from "../../../projects/ngx-ramblers/src/app/models/ai.model";
import { signedJsonPost } from "../ramblers/integration-worker-crypto";
import { stripTrailingSlash } from "../../../projects/ngx-ramblers/src/app/functions/strings";

const debugLog = debug(envConfig.logNamespace("ai:worker-client"));
debugLog.enabled = true;

export function integrationWorkerConfigured(): boolean {
  return !!(envConfig.value(Environment.INTEGRATION_WORKER_URL) && envConfig.value(Environment.INTEGRATION_WORKER_SHARED_SECRET));
}

async function callWorker<T>(operationPath: string, payload: object): Promise<T> {
  const workerUrl = required(Environment.INTEGRATION_WORKER_URL);
  const sharedSecret = required(Environment.INTEGRATION_WORKER_SHARED_SECRET);
  const endpoint = `${stripTrailingSlash(workerUrl)}/api/integration-worker/ai/${operationPath}`;
  const response = await signedJsonPost(endpoint, sharedSecret, payload);
  const text = await response.text();
  if (!response.ok) {
    debugLog(operationPath, "failed", response.status, text.slice(0, 200));
    throw new Error(`Integration worker ai/${operationPath} failed with status ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export async function rewriteViaIntegrationWorker(config: Ai, input: string, systemPrompt: string, maxTokens: number): Promise<string> {
  const result = await callWorker<{ output: string }>("rewrite", {config, input, systemPrompt, maxTokens});
  return result.output;
}

export async function aiStatusViaIntegrationWorker(config: Ai): Promise<AiConnectionStatus> {
  return callWorker<AiConnectionStatus>("status", {config});
}

export async function chooseCoverViaIntegrationWorker(
  config: Ai,
  candidates: CoverImageCandidate[],
  rootFolder?: string,
  albumName?: string
): Promise<string | null> {
  const result = await callWorker<{ image: string | null }>("choose-cover", {config, candidates, rootFolder, albumName});
  return result?.image ?? null;
}

function required(key: Environment): string {
  const value = envConfig.value(key);
  if (!value) {
    throw new Error(`Environment variable '${key}' must be set to call the integration worker AI API`);
  }
  return value;
}
