import { auth } from "../models/auth";
import * as authCommon from "./auth-common";
import debug from "debug";
import { envConfig } from "../../env-config/env-config";
import * as authConfig from "../../auth/auth-config";
import { Member, MemberCookie } from "../../../../projects/ngx-ramblers/src/app/models/member.model";
import * as transforms from "./transforms";
import { Request, Response } from "express";
import * as crudController from "./crud-controller";
import { member } from "../models/member";

const debugLog = debug(envConfig.logNamespace("database:login"));
debugLog.enabled = false;
const authenticationFailureMessage = "incorrect username and password combination";
const controller = crudController.create<Member>(member);
export function login(req: Request, res: Response) {
  try {
    const userName = req.body.userName;
    debugLog("attempting to login userName:", userName);
    auth.findOne(authCommon.userNameOrEmailCriteria(userName))
      .then((document: any) => {
        const member: Member = transforms.toObjectWithId(document);
        if (member) {
          const memberCookie: MemberCookie = authCommon.toMemberCookie(member);
          return authConfig.compareMemberPassword(req.body.password, member.password).then(success => {
            if (success) {
              authCommon.returnResponse({res, member, memberCookie});
            } else {
              authCommon.returnAuthFailure({res, message: authenticationFailureMessage, userName});
            }
          });
        } else {
          authCommon.returnAuthFailure({
            res,
            message: authenticationFailureMessage,
            userName
          });
        }
      })
      .catch(error => {
        if (error) {
          controller.errorDebugLog("database:login:catch", error);
          authCommon.returnAuthFailure({res, message: "an unexpected error - " + error, status: 500});
        } else {
          authCommon.returnAuthFailure({res, message: "Your member credentials were not entered correctly"});
        }
      });
  } catch (error) {
    controller.errorDebugLog("database:login:catch", error);
    authCommon.returnAuthFailure({res, message: "an unexpected error - " + error, status: 500});
  }
}
