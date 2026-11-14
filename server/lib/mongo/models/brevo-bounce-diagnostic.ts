import mongoose from "mongoose";
import { ensureModel } from "../utils/model-utils";
import { BrevoBounceDiagnostic } from "../../../../projects/ngx-ramblers/src/app/models/mail.model";

const schema = new mongoose.Schema({
  eventKey: {type: String, required: true, unique: true},
  email: {type: String, required: true, index: true},
  memberId: {type: String},
  providerEvent: {type: String, required: true},
  event: {type: String, required: true},
  reason: {type: String},
  sendingIp: {type: String},
  campaignId: {type: Number},
  messageId: {type: String},
  eventAt: {type: Number, required: true},
  receivedAt: {type: Number, required: true}
}, {collection: "brevoBounceDiagnostics"});

schema.index({email: 1, eventAt: -1});

export const brevoBounceDiagnostic: mongoose.Model<BrevoBounceDiagnostic & {receivedAt: number}> =
  ensureModel<BrevoBounceDiagnostic & {receivedAt: number}>("brevo-bounce-diagnostic", schema);
