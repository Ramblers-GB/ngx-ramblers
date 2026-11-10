import express from "express";
import * as authConfig from "../auth/auth-config";
import {exportDocx} from "./document-export-controllers";

const router = express.Router();

router.post("/docx", authConfig.authenticate(), exportDocx);

export const documentExportRoutes = router;
