import express from "express";
import { cancelBackupsJob, submitBackupsJob } from "./integration-worker-backups-controllers";

const router = express.Router();

router.post("/jobs", submitBackupsJob);
router.post("/jobs/:jobId/cancel", cancelBackupsJob);

export const integrationWorkerBackupsRoutes = router;
