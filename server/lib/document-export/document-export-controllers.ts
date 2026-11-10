import {documentAppearance} from "../../../projects/ngx-ramblers/src/app/models/document-appearance.model";
import {Request, Response} from "express";
import {isString} from "es-toolkit/compat";
import {BuiltInRole, CommitteeConfig, DocumentExportRequest} from "../../../projects/ngx-ramblers/src/app/models/committee.model";
import {ConfigKey} from "../../../projects/ngx-ramblers/src/app/models/config.model";
import {createErrorDebugLog} from "../shared/error-debug-log";
import {systemConfig} from "../config/system-config";
import {queryKey} from "../mongo/controllers/config";
import {objectBufferForKey} from "../aws/aws-controllers";
import {markdownToDocx} from "./markdown-to-docx";
import {toKebabCase} from "../../../projects/ngx-ramblers/src/app/functions/strings";

const errorDebugLog = createErrorDebugLog("document-export");

export async function exportDocx(req: Request, res: Response): Promise<void> {
  const title = isString(req.body?.title) ? req.body.title.trim() : "";
  const markdown = isString(req.body?.markdown) ? req.body.markdown : "";
  if (!title && !markdown.trim()) {
    res.status(400).json({error: "A title or document content is required"});
  } else {
    try {
      const request: DocumentExportRequest = {title: title || "Document", markdown, imageHeight: Number(req.body?.imageHeight) || 240, layout: req.body?.layout || null};
      const branding = await exportBranding();
      const buffer = await markdownToDocx(request, branding, branding.appearance);
      const fileName = `${toKebabCase(request.title) || "document"}.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (error) {
      errorDebugLog("exportDocx failed", error);
      res.status(500).json({error: error instanceof Error ? error.message : "Word export failed"});
    }
  }
}

async function exportBranding() {
  const config = await systemConfig();
  const committee = (await queryKey(ConfigKey.COMMITTEE))?.value as CommitteeConfig | null;
  const groupName = config?.group?.longName || config?.group?.shortName || "Ramblers";
  const groupHref = config?.group?.href || "";
  const contact = (committee?.roles || []).find(role => role.builtInRoleMapping === BuiltInRole.CONTACT_US);
  const logoImage = config?.logos?.images?.find(image => image.originalFileName === config?.header?.selectedLogo);
  let logo: Buffer | null = null;
  if (logoImage?.awsFileName) {
    try {
      logo = await objectBufferForKey(logoImage.awsFileName);
    } catch (error) {
      errorDebugLog("logo load failed", error);
      logo = null;
    }
  }
  return {groupName, groupHref, contactEmail: contact?.email || "", logo, appearance: documentAppearance(config?.documentAppearance || null)};
}
