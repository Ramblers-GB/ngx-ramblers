import debug from "debug";
import { envConfig } from "../env-config/env-config";

import {HttpProbeMethod, PublicHttpProbeResult} from "../../../projects/ngx-ramblers/src/app/models/health.model";

const debugLog = debug(envConfig.logNamespace("public-http-probe"));

const HTTP_PROBE_TIMEOUT_MS = 8000;

function probeLooksSuccessful(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 400;
}

async function probeOnce(hostname: string, method: HttpProbeMethod, signal: AbortSignal): Promise<PublicHttpProbeResult> {
  const response = await fetch(`https://${hostname}/`, { method, redirect: "manual", signal });
  await response.body?.cancel();
  return { httpStatus: response.status, httpRedirectLocation: response.headers.get("location") || "" };
}

export async function probeHttp(hostname: string, signal?: AbortSignal, method = HttpProbeMethod.HEAD): Promise<PublicHttpProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_PROBE_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    signal?.throwIfAborted();
    if (method === HttpProbeMethod.GET) {
      const response = await fetch(`https://${hostname}/`, {method, redirect: "follow", cache: "no-store", signal: requestSignal});
      if (response.ok) {
        await response.body?.pipeTo(new WritableStream(), {signal: requestSignal});
      } else {
        await response.body?.cancel();
      }
      return {httpStatus: response.ok || response.status >= 400 ? response.status : 0, httpRedirectLocation: response.redirected ? response.url : ""};
    } else {
      const headResult = await probeOnce(hostname, HttpProbeMethod.HEAD, requestSignal);
      if (probeLooksSuccessful(headResult.httpStatus)) {
        return headResult;
      } else {
        debugLog("HEAD probe for %s returned %s - retrying with GET", hostname, headResult.httpStatus);
        return await probeOnce(hostname, HttpProbeMethod.GET, requestSignal);
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    debugLog("HTTP probe failed for %s: %s", hostname, error instanceof Error ? error.message : String(error));
    if (method === HttpProbeMethod.GET) {
      return {httpStatus: 0, httpRedirectLocation: ""};
    } else {
      try {
        return await probeOnce(hostname, HttpProbeMethod.GET, requestSignal);
      } catch (getError) {
        signal?.throwIfAborted();
        debugLog("GET probe failed for %s: %s", hostname, getError instanceof Error ? getError.message : String(getError));
        return {httpStatus: 0, httpRedirectLocation: ""};
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
