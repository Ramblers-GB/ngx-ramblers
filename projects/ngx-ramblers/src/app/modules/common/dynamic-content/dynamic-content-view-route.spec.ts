import { PageContentType } from "../../../models/content-text.model";
import { AccessLevel } from "../../../models/member-resource.model";
import { DynamicContentViewRoute } from "./dynamic-content-view-route";

describe("DynamicContentViewRoute showTitle", () => {
  function routeView(title: string, liftedTitle: string | null, pageContent?: DynamicContentViewRoute["pageContent"]): DynamicContentViewRoute {
    const component = Object.create(DynamicContentViewRoute.prototype) as DynamicContentViewRoute;
    component.row = {
      type: PageContentType.ROUTE,
      columns: [{ columns: 12, accessLevel: AccessLevel.PUBLIC }],
      routeGuide: { title }
    } as DynamicContentViewRoute["row"];
    component.pageContent = pageContent;
    component["pageService"] = { contentPageTitle: () => liftedTitle } as unknown as DynamicContentViewRoute["pageService"];
    return component;
  }

  it("hides the route heading when the page shell already lifted the same title", () => {
    const component = routeView("02. Old Park from the Golf Range", "02. Old Park from the Golf Range");
    expect(component.showTitle).toBe(false);
  });

  it("shows the route heading when the page has no matching title", () => {
    const component = routeView("Barham and Four Churches", null);
    expect(component.showTitle).toBe(true);
  });
});
