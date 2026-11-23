import express from "express";
import { authenticate, requireAdmin } from "../auth/auth-config";
import { checkWalksManagerUpdate, updateFromWalksManager } from "./walks-manager-update-controllers";

const router = express.Router();

router.get("/:id/update", authenticate(), requireAdmin, checkWalksManagerUpdate);
router.post("/:id/update", authenticate(), requireAdmin, updateFromWalksManager);

export const walksManagerUpdateRoutes = router;
