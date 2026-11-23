import * as fs from "fs";
import * as path from "path";
import { AnswersQuestions, Duration, PerformsActivities, Question, Task, Wait } from "@serenity-js/core";
import { equals } from "@serenity-js/assertions";
import { isVisible } from "@serenity-js/web";
import debug from "debug";
import { envConfig } from "../../../../../env-config/env-config";
import { Environment } from "../../../../../../../projects/ngx-ramblers/src/app/models/environment.model";
import { WALKS_MANAGER_ACCESS_FILE, WALKS_MANAGER_LOGIN_SETTLE_SECONDS, WalksManagerAccess, WalksManagerAccessStatus } from "../../../../../../../projects/ngx-ramblers/src/app/models/walks-manager-access.model";
import { walksManagerAccessFrom, walksManagerAccessWithStatus } from "../../../../../../../projects/ngx-ramblers/src/app/functions/walks/walks-manager-access";
import { WalksPageElements } from "../../../ui/ramblers/walks-page-elements";
import { Visibility } from "../../../questions/common/visibility";
import { UploadWalks } from "../walks/upload-walks";
import { Login } from "./login";

const debugLog = debug(envConfig.logNamespace("check-walks-manager-access"));
const UPLOAD_MENU_WAIT = Duration.ofSeconds(10);

export class CheckWalksManagerAccess extends Task {

  static forConfiguredLogin() {
    return new CheckWalksManagerAccess("#actor checks the Walks Manager login can upload walks");
  }

  async performAs(actor: PerformsActivities & AnswersQuestions): Promise<void> {
    const access = await this.accessFor(actor).catch(error => walksManagerAccessWithStatus(WalksManagerAccessStatus.NOT_CHECKED, (error as Error).message));
    debugLog("Walks Manager access:", access.status);
    this.save(access);
  }

  private async accessFor(actor: PerformsActivities & AnswersQuestions): Promise<WalksManagerAccess> {
    await actor.attemptsTo(Login.submitCredentials(await Login.credentials()));
    await actor.attemptsTo(Wait.upTo(Duration.ofSeconds(WALKS_MANAGER_LOGIN_SETTLE_SECONDS)).until(this.loginSettled(), equals(true))).catch(() => debugLog("Walks Manager showed neither a login error nor the Create menu"));
    const loginRejected = await actor.answer(Visibility.of(WalksPageElements.authErrorMessage));
    const createMenuShown = !loginRejected && await actor.answer(Visibility.of(WalksPageElements.createMenuDropdown));
    const uploadOffered = createMenuShown && await this.uploadOffered(actor);
    return walksManagerAccessFrom(loginRejected, createMenuShown, uploadOffered);
  }

  private loginSettled() {
    return Question.about("a login error or the Create menu", async (actor: AnswersQuestions) =>
      await actor.answer(Visibility.of(WalksPageElements.authErrorMessage)) || await actor.answer(Visibility.of(WalksPageElements.createMenuDropdown)));
  }

  private async uploadOffered(actor: PerformsActivities & AnswersQuestions): Promise<boolean> {
    return actor.attemptsTo(
      UploadWalks.openCreateMenu(),
      Wait.upTo(UPLOAD_MENU_WAIT).until(WalksPageElements.uploadAWalksCSV, isVisible())
    ).then(() => true).catch(() => false);
  }

  private save(access: WalksManagerAccess): void {
    const jobPath = process.env[Environment.RAMBLERS_JOB_PATH];
    if (jobPath) {
      fs.mkdirSync(jobPath, {recursive: true});
      fs.writeFileSync(path.join(jobPath, WALKS_MANAGER_ACCESS_FILE), JSON.stringify(access));
    }
  }
}
