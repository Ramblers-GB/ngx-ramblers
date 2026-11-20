import axios, { AxiosError, AxiosInstance } from "axios";
import { isArray, isNumber } from "es-toolkit/compat";
import debug from "debug";
import {
  supporterUpdateErrorSchema,
  supporterUpdateSuccessSchema,
  bouncedEmailRequestSchema,
  supportersErrorSchema,
  supportersResponseSchema,
  unsubscribeRequestSchema,
  type BouncedEmailRequest,
  type Supporter,
  type SupporterUpdateSuccess,
  type UnsubscribeRequest,
} from "@ramblers/sf-contract";
import {
  GroupCodeToken,
  SalesforceConfig,
} from "../../../projects/ngx-ramblers/src/app/models/salesforce.model";
import { envConfig } from "../env-config/env-config";
import { dateTimeNowAsValue } from "../shared/dates";
import { parseGroupCodes, salesforceEndpointBaseUrl } from "./salesforce-config";
import { redactCredentials } from "./salesforce-redaction";
import {
  SalesforceClientResult,
  SalesforceListOptions,
} from "./salesforce.model";

const debugLog = debug(envConfig.logNamespace("salesforce-client"));
debugLog.enabled = false;

export function buildSalesforceClient(endpointBaseUrl: string): AxiosInstance {
  const baseURL = salesforceEndpointBaseUrl(endpointBaseUrl);
  if (!baseURL) {
    throw new Error("Salesforce endpointBaseUrl is not configured");
  }
  return axios.create({
    baseURL,
    timeout: 60_000,
    validateStatus: () => true,
  });
}

export function tokenForGroupCode(salesforceConfig: SalesforceConfig, groupCode: string): string | undefined {
  return salesforceConfig?.apiKeysByGroupCode?.[groupCode];
}

export function activeGroupCodeWithToken(salesforceConfig: SalesforceConfig, siteGroupCode: string): GroupCodeToken | null {
  return parseGroupCodes(siteGroupCode)
    .map(groupCode => ({groupCode, token: tokenForGroupCode(salesforceConfig, groupCode)}))
    .find((entry): entry is GroupCodeToken => !!entry.token && entry.token.length > 0) ?? null;
}

function errorResult<T>(status: number, body: unknown, latencyMs: number): SalesforceClientResult<T> {
  const supportersError = supportersErrorSchema.safeParse(body);
  const updateError = supporterUpdateErrorSchema.safeParse(body);
  const parsed = supportersError.success ? supportersError.data : updateError.success ? updateError.data : null;
  return {
    status,
    errorCode: parsed?.errorType ?? `HTTP_${status}`,
    errorMessage: parsed?.errorDescription ?? `Unexpected status ${status}`,
    latencyMs,
  };
}

function invalidSupporterSummary(issues: { path: PropertyKey[]; message: string }[], body: unknown): string {
  const first = issues[0];
  const recordIndex = isNumber(first?.path?.[0]) ? first.path[0] as number : null;
  const record = recordIndex !== null && isArray(body) ? body[recordIndex] : null;
  const membershipNo = record?.membershipNo ? ` (membership no. ${record.membershipNo})` : "";
  const field = first?.path?.slice(recordIndex !== null ? 1 : 0).map(String).join(".") || "response";
  const where = recordIndex !== null ? `supporter ${recordIndex + 1}${membershipNo} ${field}` : field;
  const more = issues.length > 1 ? ` (${issues.length} problems in total)` : "";
  return `${where}: ${first?.message ?? "does not match the contract"}${more}.`;
}

function networkError<T>(error: unknown, startedAt: number): SalesforceClientResult<T> {
  const axiosError = error as AxiosError;
  return {
    status: axiosError.response?.status ?? 0,
    errorCode: axiosError.code ?? "NETWORK_ERROR",
    errorMessage: redactCredentials(axiosError.message || "Network request failed"),
    latencyMs: dateTimeNowAsValue() - startedAt,
  };
}

function credentials(config: SalesforceConfig, groupCode: string): Record<string, string> | null {
  const apiKey = tokenForGroupCode(config, groupCode);
  return apiKey ? { api_key: apiKey, team_code: groupCode } : null;
}

export async function fetchSalesforceMembers(
  salesforceConfig: SalesforceConfig,
  options: SalesforceListOptions,
): Promise<SalesforceClientResult<Supporter[]>> {
  const params = credentials(salesforceConfig, options.groupCode);
  if (!params) {
    return {
      status: 0,
      errorCode: "TOKEN_MISSING",
      errorMessage: `No API token configured for group ${options.groupCode}.`,
      latencyMs: 0,
    };
  }
  const client = buildSalesforceClient(salesforceConfig.endpointBaseUrl);
  const startedAt = dateTimeNowAsValue();
  try {
    const response = await client.get<unknown>("/get_supporters", { params });
    const latencyMs = dateTimeNowAsValue() - startedAt;
    if (response.status >= 200 && response.status < 300) {
      const parsed = supportersResponseSchema.safeParse(response.data);
      return parsed.success
        ? { status: response.status, data: parsed.data, latencyMs }
        : {
          status: response.status,
          errorCode: "INVALID_RESPONSE",
          errorMessage: `Ramblers Team Emails returned an invalid supporter response: ${invalidSupporterSummary(parsed.error.issues, response.data)}`,
          latencyMs,
        };
    } else {
      return errorResult(response.status, response.data, latencyMs);
    }
  } catch (error) {
    return networkError(error, startedAt);
  }
}

export function pingSalesforce(
  salesforceConfig: SalesforceConfig,
  groupCode: string,
): Promise<SalesforceClientResult<Supporter[]>> {
  return fetchSalesforceMembers(salesforceConfig, { groupCode });
}

export async function pushSalesforceConsent(
  salesforceConfig: SalesforceConfig,
  request: UnsubscribeRequest,
  groupCode: string,
): Promise<SalesforceClientResult<SupporterUpdateSuccess>> {
  const validRequest = unsubscribeRequestSchema.safeParse(request);
  if (!validRequest.success) {
    return { status: 0, errorCode: "INVALID_REQUEST", errorMessage: "Unsubscribe request does not match the Ramblers Team Emails contract.", latencyMs: 0 };
  }
  const params = credentials(salesforceConfig, groupCode);
  if (!params) {
    return {
      status: 0,
      errorCode: "TOKEN_MISSING",
      errorMessage: `No API token configured for group ${groupCode || "(none)"}.`,
      latencyMs: 0,
    };
  }
  const client = buildSalesforceClient(salesforceConfig.endpointBaseUrl);
  const startedAt = dateTimeNowAsValue();
  try {
    const response = await client.post<unknown>("/unsubscribe", request, { params });
    const latencyMs = dateTimeNowAsValue() - startedAt;
    if (response.status >= 200 && response.status < 300) {
      const parsed = supporterUpdateSuccessSchema.safeParse(response.data);
      return parsed.success
        ? { status: response.status, data: parsed.data, latencyMs }
        : { status: response.status, errorCode: "INVALID_RESPONSE", errorMessage: "Ramblers Team Emails returned an invalid unsubscribe response.", latencyMs };
    }
    return errorResult(response.status, response.data, latencyMs);
  } catch (error) {
    return networkError(error, startedAt);
  }
}

export async function pushSalesforceBounce(
  salesforceConfig: SalesforceConfig,
  request: BouncedEmailRequest,
  groupCode: string,
): Promise<SalesforceClientResult<SupporterUpdateSuccess>> {
  const validRequest = bouncedEmailRequestSchema.safeParse(request);
  if (!validRequest.success) {
    return { status: 0, errorCode: "INVALID_REQUEST", errorMessage: "Bounce request does not match the Ramblers Team Emails contract.", latencyMs: 0 };
  }
  const params = credentials(salesforceConfig, groupCode);
  if (!params) {
    return { status: 0, errorCode: "TOKEN_MISSING", errorMessage: `No API token configured for group ${groupCode || "(none)"}.`, latencyMs: 0 };
  }
  const client = buildSalesforceClient(salesforceConfig.endpointBaseUrl);
  const startedAt = dateTimeNowAsValue();
  try {
    const response = await client.post<unknown>("/bounced_email", request, { params });
    const latencyMs = dateTimeNowAsValue() - startedAt;
    if (response.status >= 200 && response.status < 300) {
      const parsed = supporterUpdateSuccessSchema.safeParse(response.data);
      return parsed.success
        ? { status: response.status, data: parsed.data, latencyMs }
        : { status: response.status, errorCode: "INVALID_RESPONSE", errorMessage: "Ramblers Team Emails returned an invalid bounce response.", latencyMs };
    }
    return errorResult(response.status, response.data, latencyMs);
  } catch (error) {
    return networkError(error, startedAt);
  }
}
