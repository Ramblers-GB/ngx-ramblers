import { Request, Response } from "express";
import multer from "multer";
import { envConfig } from "../env-config/env-config";

export const receiveEsriFile = multer({dest: envConfig.server.uploadDir}).single("file");

export { importEsriRoute } from "./map-route-import";
export { routeTurnStepsHandler } from "./route-turn-steps";
export { routeHeightsHandler } from "./route-heights";

export function uploadEsriFile(req: Request, res: Response): void {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    res.status(400).json({message: "No file uploaded"});
  } else {
    res.status(200).json({
      filePath: uploadedFile.path,
      originalName: uploadedFile.originalname
    });
  }
}
