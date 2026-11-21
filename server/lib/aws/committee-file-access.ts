import { escapeRegExp } from "es-toolkit/compat";
import { NextFunction, Request, Response } from "express";
import { MemberCookie } from "../../../projects/ngx-ramblers/src/app/models/member.model";
import committeeFile from "../mongo/models/committee-file";
import { visibleCommitteeFileCriteria } from "../mongo/controllers/committee-file-controllers";

const COMMITTEE_FILES_PREFIX = "committeeFiles/";

async function visibleDocumentReferences(key: string, visible: object): Promise<boolean> {
  const byFileName = await committeeFile.exists({$and: [{"fileNameData.awsFileName": key.substring(COMMITTEE_FILES_PREFIX.length)}, visible]});
  return !!byFileName || !!await committeeFile.exists({$and: [{"document.markdown": {$regex: escapeRegExp(key)}}, visible]});
}

export async function requireCommitteeAttachmentAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = `${req.params.bucket}${req.params[0] || ""}`;
    if ((req.user as MemberCookie)?.fileAdmin) {
      res.locals.privateCommitteeFile = true;
      next();
    } else if (key.startsWith(COMMITTEE_FILES_PREFIX)) {
      if (await visibleDocumentReferences(key, await visibleCommitteeFileCriteria(req))) {
        res.locals.privateCommitteeFile = true;
        next();
      } else {
        res.status(404).json({error: "Document not found"});
      }
    } else {
      next();
    }
  } catch (error) {
    next(error);
  }
}
