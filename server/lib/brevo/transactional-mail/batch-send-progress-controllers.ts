import { NextFunction, Request, Response } from "express";
import { MemberCookie } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { batchSendJobs } from "./batch-send-progress";

export function requireBatchSendOwner(req: Request, res: Response, next: NextFunction): void {
  const progress = batchSendJobs.get(req.params["jobId"]);
  const currentMemberId = (req.user as MemberCookie)?.memberId;
  if (progress && progress.requestedBy !== currentMemberId) {
    res.status(403).json({error: {message: "You can only view or cancel your own email sends"}});
  } else {
    next();
  }
}

