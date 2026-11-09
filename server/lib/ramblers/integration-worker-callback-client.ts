import {
  IntegrationWorkerCallbackConfig,
  IntegrationWorkerProgressCallbackRequest,
  IntegrationWorkerResultCallbackRequest
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { postSignedWorkerBody } from "./integration-worker-crypto";

export async function postRamblersUploadProgressCallback(callback: IntegrationWorkerCallbackConfig, sharedSecret: string, request: IntegrationWorkerProgressCallbackRequest): Promise<void> {
  await postRamblersUploadCallback(`${callback.baseUrl}${callback.progressPath}`, sharedSecret, request);
}

export async function postRamblersUploadResultCallback(callback: IntegrationWorkerCallbackConfig, sharedSecret: string, request: IntegrationWorkerResultCallbackRequest): Promise<void> {
  await postRamblersUploadCallback(`${callback.baseUrl}${callback.resultPath}`, sharedSecret, request);
}

async function postRamblersUploadCallback(url: string, sharedSecret: string, request: object): Promise<void> {
  await postSignedWorkerBody(url, sharedSecret, request);
}
