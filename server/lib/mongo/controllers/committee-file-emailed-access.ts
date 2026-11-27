import { isObject, isString, omit, uniq } from "es-toolkit/compat";
import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { signValue } from "../../auth/auth-config";
import { envConfig } from "../../env-config/env-config";
import { ApiAction } from "../../../../projects/ngx-ramblers/src/app/models/api-response.model";
import {
  CommitteeAttachmentPurpose,
  EMAILED_ACCESS_KEY_EXPIRY_SECONDS,
  EmailedAccessKeyPayload
} from "../../../../projects/ngx-ramblers/src/app/models/committee.model";
import { emailedAccessKeysFromCookieHeader } from "../../../../projects/ngx-ramblers/src/app/functions/emailed-access";
import committeeFile from "../models/committee-file";
import { createErrorDebugLog } from "../../shared/error-debug-log";

const errorDebugLog = createErrorDebugLog("committee-emailed-access");
const verifiedFileIdsByRequest = new WeakMap<Request, Promise<string[]>>();

function verifiedPayload(key: string): EmailedAccessKeyPayload | null {
  try {
    const payload = jwt.verify(key, envConfig.auth().secret);
    return !isString(payload) && payload.purpose === CommitteeAttachmentPurpose.EMAILED_ACCESS && isString(payload.committeeFileId)
      ? payload as EmailedAccessKeyPayload
      : null;
  } catch (error) {
    errorDebugLog("emailed access key rejected", error.name);
    return null;
  }
}

async function currentFileIds(payloads: EmailedAccessKeyPayload[]): Promise<string[]> {
  if (payloads.length === 0) {
    return [];
  } else {
    const files = await committeeFile.find({_id: {$in: uniq(payloads.map(payload => payload.committeeFileId))}}, {emailedAccessVersion: 1}).lean().exec();
    return files
      .filter(file => payloads.some(payload => payload.committeeFileId === file._id.toString() && payload.version === ((file as any).emailedAccessVersion ?? 0)))
      .map(file => file._id.toString());
  }
}

export function emailedAccessFileIds(req: Request): Promise<string[]> {
  const cached = verifiedFileIdsByRequest.get(req);
  if (cached) {
    return cached;
  } else {
    const payloads = emailedAccessKeysFromCookieHeader(req.headers?.cookie).map(verifiedPayload).filter(payload => !!payload);
    const fileIds = currentFileIds(payloads).catch(error => {
      errorDebugLog("emailed access lookup failed", error);
      return [];
    });
    verifiedFileIdsByRequest.set(req, fileIds);
    return fileIds;
  }
}

export async function emailedAccessKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await committeeFile.findById(req.params.id, {emailedAccessVersion: 1}).lean().exec();
    if (file) {
      const payload: EmailedAccessKeyPayload = {
        purpose: CommitteeAttachmentPurpose.EMAILED_ACCESS,
        committeeFileId: req.params.id,
        version: (file as any).emailedAccessVersion ?? 0
      };
      res.setHeader("Cache-Control", "private, no-store");
      res.json({action: ApiAction.QUERY, response: {key: signValue(payload, EMAILED_ACCESS_KEY_EXPIRY_SECONDS)}});
    } else {
      res.status(404).json({error: "Document not found"});
    }
  } catch (error) {
    next(error);
  }
}

export async function revokeEmailedAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await committeeFile.findByIdAndUpdate(req.params.id, {$inc: {emailedAccessVersion: 1}}, {new: true}).lean().exec();
    if (file) {
      res.json({action: ApiAction.UPDATE, response: {emailedAccessVersion: (file as any).emailedAccessVersion}});
    } else {
      res.status(404).json({error: "Document not found"});
    }
  } catch (error) {
    next(error);
  }
}

export function preserveEmailedAccessVersion(req: Request, _res: Response, next: NextFunction): void {
  if (isObject(req.body)) {
    req.body = omit(req.body, ["emailedAccessVersion"]);
  }
  next();
}
