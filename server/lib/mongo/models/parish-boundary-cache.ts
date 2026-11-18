import mongoose from "mongoose";
import { ensureModel } from "../utils/model-utils";
import { ParishBoundaryCacheRecord } from "../../parishes/parish-cache.model";

const schema = new mongoose.Schema({
  key: {type: String, required: true, unique: true},
  compressedData: {type: Buffer, required: true},
  timestamp: {type: Number, required: true}
}, {collection: "parishBoundaryCache"});

export const parishBoundaryCache = ensureModel<ParishBoundaryCacheRecord>("parish-boundary-cache", schema);
