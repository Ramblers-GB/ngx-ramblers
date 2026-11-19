import { Request, Response } from "express";
import { createErrorDebugLog } from "../shared/error-debug-log";
import { awsS3InventoryView } from "./aws-s3-inventory";

const errorDebugLog = createErrorDebugLog("aws-s3-inventory-controllers");

export async function listAwsS3Inventory(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await awsS3InventoryView());
  } catch (error) {
    errorDebugLog("listAwsS3Inventory:", error?.message || error);
    res.status(500).json({error: error?.message || "Could not list AWS S3 buckets"});
  }
}
