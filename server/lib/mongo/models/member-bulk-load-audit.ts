import mongoose from "mongoose";
import { ensureModel } from "../utils/model-utils";
import { MemberBulkLoadAudit } from "../../../../projects/ngx-ramblers/src/app/models/member.model";

const StatusMessageSchema = new mongoose.Schema({
  status: {type: String},
  message: {type: String}
}, {_id: false});

const RamblersMemberSchema = new mongoose.Schema({
  membershipExpiryDate: {type: String},
  membershipNumber: {type: String},
  salesforceId: {type: String},
  salesforceMemberRef: {type: String},
  salesforceTeamStatus: {type: String},
  salesforceTeamRelationshipFrom: {type: String},
  groupCodes: {type: [String], default: undefined},
  wellbeingWalker: {type: Boolean},
  walkLeader: {type: Boolean},
  canEmailVolunteers: {type: Boolean},
  canEmailMembers: {type: Boolean},
  canEmailWellbeingWalkers: {type: Boolean},
  canViewMemberData: {type: Boolean},
  canViewVolunteerData: {type: Boolean},
  doNotEmail: {type: Boolean},
  noWalkProgram: {type: Boolean},
  noCampaigning: {type: Boolean},
  noSurveys: {type: Boolean},
  postConsent: {type: Boolean},
  postConsentLastUpdated: {type: String},
  phoneConsent: {type: Boolean},
  phoneConsentLastUpdated: {type: String},
  emailConsentWellbeingWalks: {type: Boolean},
  membershipJoinDate: {type: String},
  membershipEndDate: {type: String},
  volunteerRoles: {type: String},
  mobileNumber: {type: String},
  email: {type: String},
  firstName: {type: String},
  lastName: {type: String},
  postcode: {type: String},
  memberStatus: {type: String},
  memberTerm: {type: String},
  jointWith: {type: String},
  title: {type: String},
  type: {type: String},
  landlineTelephone: {type: String},
  emailMarketingConsent: {type: String},
  emailPermissionLastUpdated: {type: String}
}, {_id: false});

const MemberBulkLoadAuditSchema = new mongoose.Schema({
  createdDate: {type: Number},
  createdBy: {type: String},
  files: {
    archive: {type: String},
    data: {type: String},
  },
  applyStartedAt: {type: Number},
  appliedAt: {type: Number},
  auditLog: [StatusMessageSchema],
  members: [RamblersMemberSchema]
}, {collection: "memberBulkLoadAudit"});

export const memberBulkLoadAudit: mongoose.Model<MemberBulkLoadAudit> = ensureModel<MemberBulkLoadAudit>("member-bulk-load-audit", MemberBulkLoadAuditSchema);
