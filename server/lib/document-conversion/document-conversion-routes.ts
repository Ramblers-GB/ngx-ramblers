import express from "express";
import * as authConfig from "../auth/auth-config";
import { requireCommitteeFileAdmin } from "../mongo/controllers/committee-file-controllers";
import { convertUploadedFile, convertClipboardHtml, convertCommitteeFile, receiveUploadedFile } from "./document-conversion-controllers";

const router = express.Router();

router.post("/file", authConfig.authenticate(), receiveUploadedFile, convertUploadedFile);
router.post("/clipboard-html", authConfig.authenticate(), convertClipboardHtml);
router.post("/committee-file/:id", authConfig.authenticate(), requireCommitteeFileAdmin, convertCommitteeFile);

export default router;
