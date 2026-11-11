import express from "express";
import { contentMigrationProgressCallback, contentMigrationResultCallback } from "./integration-worker-content-migration-callback-controllers";

const router = express.Router();

router.post("/progress", contentMigrationProgressCallback);
router.post("/result", contentMigrationResultCallback);

export const integrationWorkerContentMigrationCallbackRoutes = router;
