import express from "express";
import * as authConfig from "../auth/auth-config";
import { receiveEsriFile, importEsriRoute, routeHeightsHandler, routeTurnStepsHandler, uploadEsriFile } from "./map-route-controllers";

const router = express.Router();

router.post("/import-esri", authConfig.authenticate(), receiveEsriFile, importEsriRoute);
router.post("/turn-steps", authConfig.authenticate(), routeTurnStepsHandler);
router.post("/heights", authConfig.authenticate(), routeHeightsHandler);
router.post("/upload-esri", authConfig.authenticate(), receiveEsriFile, uploadEsriFile);

export const mapRouteRoutes = router;
