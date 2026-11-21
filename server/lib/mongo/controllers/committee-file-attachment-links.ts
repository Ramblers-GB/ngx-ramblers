import { isString } from "es-toolkit/compat";
import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";
import { signValue } from "../../auth/auth-config";
import { envConfig } from "../../env-config/env-config";
import { ApiAction } from "../../../../projects/ngx-ramblers/src/app/models/api-response.model";
import { CommitteeAttachmentPurpose } from "../../../../projects/ngx-ramblers/src/app/models/committee.model";
import { createErrorDebugLog } from "../../shared/error-debug-log";

const errorDebugLog = createErrorDebugLog("committee-attachment-links");

export function attachmentLink(req: Request, res: Response): void {
  const token = signValue({purpose: CommitteeAttachmentPurpose.PREVIEW, committeeFileId: req.params.id}, 300);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({action: ApiAction.QUERY, response: {url: `/api/database/committee-file/${req.params.id}/preview/${token}`}});
}

export function requireAttachmentLink(req: Request, res: Response, next: NextFunction): void {
  try {
    const payload = jwt.verify(req.params.token, envConfig.auth().secret);
    if (!isString(payload) && payload.purpose === CommitteeAttachmentPurpose.PREVIEW && payload.committeeFileId === req.params.id) {
      next();
    } else {
      res.status(404).json({error: "Document attachment not found"});
    }
  } catch (error) {
    errorDebugLog("attachment preview link rejected", error.name);
    res.status(404).json({error: "Document attachment not found"});
  }
}
