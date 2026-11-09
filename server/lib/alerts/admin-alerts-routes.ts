import express from "express";
import * as authConfig from "../auth/auth-config";
import { listAdminAlertRecipients, saveAdminAlertRecipients } from "./admin-alerts-controllers";

const router = express.Router();

router.get("/recipients", authConfig.authenticate(), listAdminAlertRecipients);
router.put("/recipients", authConfig.authenticate(), saveAdminAlertRecipients);

export const adminAlertsRoutes = router;
