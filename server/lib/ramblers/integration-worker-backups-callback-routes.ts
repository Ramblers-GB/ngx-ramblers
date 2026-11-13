import express from "express";
import { backupsProgressCallback, backupsResultCallback } from "./integration-worker-backups-callback-controllers";

const router = express.Router();

router.post("/progress", backupsProgressCallback);
router.post("/result", backupsResultCallback);

export const integrationWorkerBackupsCallbackRoutes = router;
