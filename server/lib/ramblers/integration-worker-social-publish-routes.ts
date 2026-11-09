import express from "express";
import { submitSocialPublishJob } from "./integration-worker-social-publish-controllers";

const router = express.Router();

router.post("/jobs", submitSocialPublishJob);

export const integrationWorkerSocialPublishRoutes = router;
