import { TestBed } from "@angular/core/testing";
import { RouteDirectionsEditor } from "./route-directions-editor";
import { RouteTurnsService } from "../../services/maps/route-turns.service";
import { StringUtilsService } from "../../services/string-utils.service";
import { RouteDirectionsChrome } from "../../models/route-follow.model";

describe("empty route directions", () => {
  it("omits the frame in view mode but keeps generation available in edit mode", () => {
    TestBed.configureTestingModule({providers: [
      {provide: RouteTurnsService, useValue: {}},
      {provide: StringUtilsService, useValue: {}}
    ]});
    const fixture = TestBed.createComponent(RouteDirectionsEditor);
    fixture.componentRef.setInput("chrome", RouteDirectionsChrome.VIEW);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".thumbnail-heading-frame")).toBeNull();
    fixture.componentRef.setInput("chrome", RouteDirectionsChrome.PANEL);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Generate directions");
  });
});

describe("route directions panel", () => {
  it("keeps one Directions frame without nesting a labelled frame around the steps", () => {
    TestBed.configureTestingModule({providers: [
      {provide: RouteTurnsService, useValue: {}},
      {provide: StringUtilsService, useValue: {}}
    ]});
    const fixture = TestBed.createComponent(RouteDirectionsEditor);
    fixture.componentRef.setInput("gpxFile", {awsFileName: "route.gpx"});
    fixture.componentRef.setInput("waypoints", [{id: "1", latitude: 51, longitude: -1, instruction: "Go left"}]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain("Go left");
    expect(element.querySelectorAll(".thumbnail-heading-frame")).toHaveLength(1);
    expect(element.textContent).not.toContain("How to follow this route");
  });
});

describe("route directions before the route is saved", () => {
  it("still shows the generated steps in a scroll box beside the save-first note", () => {
    TestBed.configureTestingModule({providers: [
      {provide: RouteTurnsService, useValue: {}},
      {provide: StringUtilsService, useValue: {}}
    ]});
    const fixture = TestBed.createComponent(RouteDirectionsEditor);
    fixture.componentRef.setInput("waypoints", [
      {id: "1", latitude: 51, longitude: -1, instruction: "Go left"},
      {id: "2", latitude: 51.001, longitude: -1, instruction: "Go right"}
    ]);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain("Save the route first");
    expect(element.textContent).toContain("Go right");
    expect((element.querySelector(".route-guide-list") as HTMLElement).style.maxHeight).toBe("280px");
    expect(element.querySelector(".control-pill[aria-label='Map view']")).toBeNull();
    expect(element.querySelector(".control-pill-fill")).not.toBeNull();
  });
});
