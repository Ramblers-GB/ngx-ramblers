import express from "express";
import * as authConfig from "../../auth/auth-config";
import { audienceMemberIds, filterSelection, listCounts, membersByReference, memberSearch, page, requireEmailComposer, summary } from "../controllers/email-composer-audience";

const router = express.Router();

router.post("/summary", authConfig.authenticate(), requireEmailComposer, summary);
router.post("/page", authConfig.authenticate(), requireEmailComposer, page);
router.get("/members", authConfig.authenticate(), requireEmailComposer, memberSearch);
router.get("/list-counts", authConfig.authenticate(), requireEmailComposer, listCounts);
router.post("/selection", authConfig.authenticate(), requireEmailComposer, filterSelection);
router.post("/member-ids", authConfig.authenticate(), requireEmailComposer, audienceMemberIds);
router.post("/members", authConfig.authenticate(), requireEmailComposer, membersByReference);

export const emailComposerAudienceRoutes = router;
