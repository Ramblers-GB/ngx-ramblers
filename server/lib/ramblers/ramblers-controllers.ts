import multer from "multer";
import { envConfig } from "../env-config/env-config";

export { uploadRamblersData } from "./member-bulk-load";

export const receiveMonthlyReport = multer({dest: envConfig.server.uploadDir}).any();
