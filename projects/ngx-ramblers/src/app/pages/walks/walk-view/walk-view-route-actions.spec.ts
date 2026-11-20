import { afterEach, describe, expect, it, vi } from "vitest";
import { WalkViewComponent } from "./walk-view";
import { StoredValue } from "../../../models/ui-actions.model";

function walkView(options: {coarsePointer: boolean; hasGpx?: boolean; canEditWalk?: boolean; mayRecord?: boolean}) {
  vi.stubGlobal("matchMedia", (query: string) => ({matches: options.coarsePointer && query === "(pointer: coarse)"}));
  const instance = Object.create(WalkViewComponent.prototype) as WalkViewComponent;
  const openRouteFollow = vi.fn();
  Object.assign(instance, {
    loggedIn: true,
    displayedWalk: {walk: {id: "walk-1"}},
    payloadService: {walkHasGpx: () => !!options.hasGpx, walkHasStart: () => true},
    mobileAccess: {allowed: () => options.mayRecord ?? true},
    display: {allowAdminEdits: () => false, allowEdits: () => options.canEditWalk ?? true},
    openRouteFollow
  });
  return {instance, openRouteFollow};
}

describe("walk view route actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers to record the route on a phone or tablet", () => {
    const {instance} = walkView({coarsePointer: true});
    expect(instance.canRecordRoute()).toBe(true);
    expect(instance.canPlotRoute()).toBe(false);
  });

  it("offers to plot the route on a desktop or laptop, where recording is not possible", () => {
    const {instance, openRouteFollow} = walkView({coarsePointer: false});
    expect(instance.canRecordRoute()).toBe(false);
    expect(instance.canPlotRoute()).toBe(true);
    instance.plotRoute();
    expect(openRouteFollow).toHaveBeenCalledWith({[StoredValue.EDIT_ROUTE]: "true"});
  });

  it("offers neither on a desktop to someone who cannot edit the walk", () => {
    const {instance} = walkView({coarsePointer: false, canEditWalk: false});
    expect(instance.canPlotRoute()).toBe(false);
    expect(instance.canRecordRoute()).toBe(false);
  });

  it("offers to follow, not record or plot, once the walk has a route", () => {
    const {instance} = walkView({coarsePointer: false, hasGpx: true});
    expect(instance.canFollowRoute()).toBe(true);
    expect(instance.canPlotRoute()).toBe(false);
  });
});
