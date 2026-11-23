import { afterEach, describe, it } from "@serenity-js/playwright-test";
import { Start } from "../screenplay/tasks/common/start";
import { SaveBrowserSource } from "../screenplay/tasks/common/save-browser-source";
import { CheckWalksManagerAccess } from "../screenplay/tasks/ramblers/common/check-walks-manager-access";
import { resolveSerenityActorName } from "../resolve-actor-name";

const actor = resolveSerenityActorName();

describe("Walks Manager access", () => {

  afterEach(async ({ actorCalled }) => {
    await actorCalled(actor).attemptsTo(SaveBrowserSource.toFile("walks-manager-access-after.html"));
  });

  it("checks the Walks Manager login can upload walks", async ({ actorCalled }) => {
    await actorCalled(actor).attemptsTo(
      Start.onWalksAndEventsManager(),
      CheckWalksManagerAccess.forConfiguredLogin()
    );
  });

});
