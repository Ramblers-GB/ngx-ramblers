import express from "express";
import { socialPublishProgress, socialPublishResult } from "./integration-worker-social-publish-callback-controllers";

const router = express.Router();

router.post("/progress", socialPublishProgress);
router.post("/result", socialPublishResult);

export const integrationWorkerSocialPublishCallbackRoutes = router;
