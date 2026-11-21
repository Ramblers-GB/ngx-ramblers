import { objectData } from "../../aws/aws-controllers";
import { NextFunction, Request, Response } from "express";
import { pipeline, Readable } from "stream";
import { ReadableStream } from "stream/web";
import { committeeFileVisible } from "../../../../projects/ngx-ramblers/src/app/functions/committee-file-access";
import { CommitteeConfig } from "../../../../projects/ngx-ramblers/src/app/models/committee.model";
import { MemberCookie } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import { ConfigKey } from "../../../../projects/ngx-ramblers/src/app/models/config.model";
import { Environment } from "../../../../projects/ngx-ramblers/src/app/models/environment.model";
import { booleanOf } from "../../shared/string-utils";
import { queryKey } from "./config";
import { parseQueryStringParameters } from "./transforms";
import committeeFile from "../models/committee-file";
import * as crudController from "./crud-controller";

const REMOTE_ATTACHMENT_TIMEOUT_MS = 20000;
const controller = crudController.create(committeeFile);
export const create = controller.create;
export const update = controller.update;
export const deleteOne = controller.deleteOne;
export const all = controller.all;
export const findByConditions = controller.findByConditions;
export const findById = controller.findById;

export async function visibleCommitteeFileCriteria(req: Request): Promise<object> {
  const config: CommitteeConfig = (await queryKey(ConfigKey.COMMITTEE))?.value;
  const member = req.user as MemberCookie || null;
  const platformAdminEnabled = booleanOf(process.env[Environment.PLATFORM_ADMIN_ENABLED]);
  const fileTypes = config?.fileTypes || [];
  const visibleTypes = {fileType: {$in: fileTypes.filter(fileType => committeeFileVisible(fileType, member, platformAdminEnabled)).map(fileType => fileType.description)}};
  return committeeFileVisible(null, member, platformAdminEnabled)
    ? {$or: [visibleTypes, {fileType: {$nin: fileTypes.map(fileType => fileType.description)}}]}
    : visibleTypes;
}

export async function restrictCommitteeFileQuery(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const criteria = parseQueryStringParameters(req).criteria || {};
    const visible = await visibleCommitteeFileCriteria(req);
    req.query.criteria = JSON.stringify((req.user as MemberCookie)?.fileAdmin ? criteria : {$and: [criteria, visible]});
    res.setHeader("Cache-Control", "private, no-store");
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireCommitteeFileView(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const visible = (req.user as MemberCookie)?.fileAdmin ? {} : await visibleCommitteeFileCriteria(req);
    const exists = await committeeFile.exists({_id: req.params.id, ...visible});
    if (exists) {
      res.setHeader("Cache-Control", "private, no-store");
      next();
    } else {
      res.status(404).json({error: "Document not found"});
    }
  } catch (error) {
    next(error);
  }
}

export function requireCommitteeFileAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req.user as MemberCookie)?.fileAdmin) {
    next();
  } else {
    res.status(403).json({error: "File admin permission required"});
  }
}

export async function attachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = await committeeFile.findById(req.params.id).lean().exec();
    const name = file?.fileNameData?.awsFileName;
    if (!name) {
      res.status(404).json({error: "Document attachment not found"});
    } else if (/^https?:/i.test(name)) {
      const remote = await fetch(name, {signal: AbortSignal.timeout(REMOTE_ATTACHMENT_TIMEOUT_MS)});
      if (remote.ok && remote.body) {
        res.setHeader("Cache-Control", "private, no-store");
        res.type(remote.headers.get("content-type") || "application/octet-stream");
        pipeline(Readable.fromWeb(remote.body as ReadableStream), res, error => {
          if (error) {
            res.destroy(error);
          }
        });
      } else {
        res.status(502).json({error: "Document attachment unavailable"});
      }
    } else {
      req.params.bucket = "committeeFiles";
      req.params[0] = `/${name}`;
      res.locals.privateCommitteeFile = true;
      await objectData(req, res);
    }
  } catch (error) {
    next(error);
  }
}
