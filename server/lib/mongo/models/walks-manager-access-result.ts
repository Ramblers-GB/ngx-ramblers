import mongoose from "mongoose";
import { values } from "es-toolkit/compat";
import { ensureModel } from "../utils/model-utils";
import { WalksManagerAccessJobResult, WalksManagerAccessStatus } from "../../../../projects/ngx-ramblers/src/app/models/walks-manager-access.model";

const walksManagerAccessResultSchema = new mongoose.Schema({
  jobId: {type: String, unique: true},
  status: {type: String, enum: values(WalksManagerAccessStatus)},
  message: {type: String},
  createdAt: {type: Number},
  completedAt: {type: Number}
}, {collection: "walksManagerAccessResults"});

export const walksManagerAccessResult: mongoose.Model<WalksManagerAccessJobResult> = ensureModel("walksManagerAccessResult", walksManagerAccessResultSchema);
