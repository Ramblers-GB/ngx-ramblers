import { Request, Response } from "express";
import { createErrorDebugLog } from "../shared/error-debug-log";
import { provisionBackupArchive } from "./backup-archive";

const errorDebugLog = createErrorDebugLog("backup-archive-controllers");

export async function provisionBackupArchiveRequest(_req: Request, res: Response): Promise<void> {
  try {
    const result = await provisionBackupArchive();
    res.json(result);
  } catch (error) {
    errorDebugLog("provisionBackupArchive:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not create the backup archive bucket"});
  }
}
