import { Ensure, equals, isPresent } from "@serenity-js/assertions";
import { Activity, AnswersQuestions, Check, Masked, PerformsActivities, Task, Wait } from "@serenity-js/core";
import { Enter, isClickable, isVisible, Text } from "@serenity-js/web";
import { SystemConfig } from "../../../../../../../projects/ngx-ramblers/src/app/models/system.model";
import { WalksPageElements } from "../../../ui/ramblers/walks-page-elements";
import { ClickWhenReady } from "../../common/click-when-ready";
import * as mongooseClient from "../../../../../mongo/mongoose-client";
import { systemConfig } from "../../../../../config/system-config";
import { Log } from "./log";
import {
  AuthErrorCookieBannerOrCreateMenuDropdown
} from "../../../questions/ramblers/auth-error-cookie-banner-or-create-menu-dropdown";
import { Accept } from "./accept-cookie-prompt";
import { Environment } from "../../../../../../../projects/ngx-ramblers/src/app/models/environment.model";
import { Retry } from "../../common/retry";
import { RamblersLoginCredentials } from "../../../../../models/ramblers-login.model";

export class Login extends Task {

  static toRamblers() {
    return Retry.times(2).each(new Login("#actor logs into Walks and Events Manager"));
  }

  static credentials(): Promise<RamblersLoginCredentials> {
    const envUsername = process.env[Environment.RAMBLERS_USERNAME];
    const envPassword = process.env[Environment.RAMBLERS_PASSWORD];
    if (envUsername && envPassword) {
      return Promise.resolve({username: envUsername, password: envPassword});
    } else {
      return mongooseClient.execute(() => systemConfig()
        .then((config: SystemConfig) => ({
          username: config?.national?.walksManager?.userName,
          password: config?.national?.walksManager?.password
        })));
    }
  }

  static submitCredentials(credentials: RamblersLoginCredentials): Activity {
    return Task.where("#actor submits the Walks and Events Manager login",
      Wait.until(WalksPageElements.authHeader, isVisible()),
      Wait.until(WalksPageElements.userName, isClickable()),
      Enter.theValue(credentials.username).into(WalksPageElements.userName),
      Enter.theValue(Masked.valueOf(credentials.password)).into(WalksPageElements.password),
      ClickWhenReady.on(WalksPageElements.loginSubmitButton),
      Wait.until(AuthErrorCookieBannerOrCreateMenuDropdown.isDisplayed(), equals(true)),
      Accept.dismissCookieBanners());
  }

  async performAs(actor: PerformsActivities & AnswersQuestions): Promise<void> {
    const credentials = await Login.credentials();
    await actor.attemptsTo(
      Check.whether(WalksPageElements.createMenuDropdown, isPresent())
        .andIfSo(Log.message("Session is already logged in so no need to login again"))
        .otherwise(
          Login.submitCredentials(credentials),
          Check.whether(WalksPageElements.createMenuDropdown, isVisible())
            .andIfSo(Ensure.that(Text.of(WalksPageElements.createMenuDropdown), equals("Create"))),
          Check.whether(WalksPageElements.authErrorMessage, isVisible())
            .andIfSo(Ensure.that(Text.of(WalksPageElements.authErrorMessage), equals("")))));
  }

}
