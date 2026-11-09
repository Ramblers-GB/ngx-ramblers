import { Request, Response } from "express";
import { configuredAdminAlertRecipients, setAdminAlertRecipients } from "./admin-alerts";

export async function listAdminAlertRecipients(_req: Request, res: Response): Promise<void> {
  try {
    res.status(200).json({response: {recipients: await configuredAdminAlertRecipients()}});
  } catch (error: any) {
    res.status(500).json({error: {message: error?.message || "Failed to load admin alert recipients"}});
  }
}

export async function saveAdminAlertRecipients(req: Request, res: Response): Promise<void> {
  try {
    const recipients = await setAdminAlertRecipients(req.body?.recipients);
    res.status(200).json({response: {recipients}});
  } catch (error: any) {
    res.status(400).json({error: {message: error?.message || "Failed to save admin alert recipients"}});
  }
}
