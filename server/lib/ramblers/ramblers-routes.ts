import express from "express";
import * as authConfig from "../auth/auth-config";
import * as groups from "./list-groups";
import { receiveMonthlyReport, uploadRamblersData } from "./ramblers-controllers";
import * as walksAndEvents from "./list-events";
import { walkLeaders } from "./list-walk-leaders";
import { lookupLibraryRoute } from "./library-route-lookup";

import { walksManagerUpdateRoutes } from "./walks-manager-update-routes";

const router = express.Router();

router.use("/walks-manager/events", walksManagerUpdateRoutes);
router.get("/library-route", lookupLibraryRoute);
router.post("/walks-manager/list-events", walksAndEvents.listEvents);
router.post("/walks-manager/list-groups", groups.listGroups);
router.post("/walks-manager/walk-leaders", authConfig.authenticate(), walkLeaders);
router.post("/monthly-reports/upload", authConfig.authenticate(), receiveMonthlyReport, uploadRamblersData);

export const ramblersRoutes = router;
