import { attachmentLink, requireAttachmentLink } from "../controllers/committee-file-attachment-links";
import express from "express";
import * as authConfig from "../../auth/auth-config";
import * as controller from "../controllers/committee-file-controllers";

const router = express.Router();

router.post("", authConfig.authenticate(), controller.requireCommitteeFileAdmin, controller.create);
router.get("", authConfig.optionalAuthenticate(), controller.restrictCommitteeFileQuery, controller.findByConditions);
router.get("/all", authConfig.optionalAuthenticate(), controller.restrictCommitteeFileQuery, controller.all);
router.put("/:id", authConfig.authenticate(), controller.requireCommitteeFileAdmin, controller.update);
router.get("/:id/attachment-link", authConfig.optionalAuthenticate(), controller.requireCommitteeFileView, attachmentLink);
router.get("/:id/preview/:token", requireAttachmentLink, controller.attachment);
router.get("/:id/attachment", authConfig.optionalAuthenticate(), controller.requireCommitteeFileView, controller.attachment);
router.get("/:id", authConfig.optionalAuthenticate(), controller.requireCommitteeFileView, controller.findById);
router.delete("/:id", authConfig.authenticate(), controller.requireCommitteeFileAdmin, controller.deleteOne);

export default router;
