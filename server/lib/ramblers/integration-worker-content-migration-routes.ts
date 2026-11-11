import express from "express";
import { cancelContentMigrationJob, submitContentMigrationJob } from "./integration-worker-content-migration-controllers";

const router = express.Router();

router.post("/jobs", submitContentMigrationJob);
router.post("/jobs/:jobId/cancel", cancelContentMigrationJob);

export const integrationWorkerContentMigrationRoutes = router;
