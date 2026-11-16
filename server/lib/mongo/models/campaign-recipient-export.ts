import mongoose from "mongoose";
import { ensureModel } from "../utils/model-utils";
import { CAMPAIGN_RECIPIENT_EXPORT_INDEX, CampaignRecipientExportRecord } from "../../brevo/campaigns/campaign-recipient-export.model";
import { CAMPAIGN_RECIPIENT_EXPORT_COLLECTION } from "../migrations/shared/collection-names";

const campaignRecipientExportSchema = new mongoose.Schema({
  campaignId: {type: Number, required: true},
  accountKey: {type: String, required: true},
  rows: {type: [mongoose.Schema.Types.Mixed], default: []},
  cachedAt: {type: Number, required: true}
}, {collection: CAMPAIGN_RECIPIENT_EXPORT_COLLECTION});

campaignRecipientExportSchema.index(CAMPAIGN_RECIPIENT_EXPORT_INDEX, {unique: true});

export const campaignRecipientExport: mongoose.Model<CampaignRecipientExportRecord> = ensureModel<CampaignRecipientExportRecord>("campaign-recipient-export", campaignRecipientExportSchema);
