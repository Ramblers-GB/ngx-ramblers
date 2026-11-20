import { SimpleChange } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { TableFilterSelectComponent } from "./table-filter-select";
import { TableTextFilterOption } from "../../../models/table-text-filter.model";

function options(): TableTextFilterOption[] {
  return ["alpha", "bravo", "charlie"].map(label => ({label, group: "Environment", count: 1, partial: false}));
}

describe("TableFilterSelectComponent keyboard use", () => {
  it("keeps the highlighted suggestion when the table sends the same values again", async () => {
    await TestBed.configureTestingModule({imports: [TableFilterSelectComponent]}).compileComponents();
    const fixture = TestBed.createComponent(TableFilterSelectComponent);
    const component = fixture.componentInstance;
    component.headings = [{heading: "Environment", suggestValues: true}];
    component.options = options();
    component.ngOnChanges({options: new SimpleChange(null, component.options, true)});
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector("input");
    input.value = "a";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown"}));
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown"}));
    const highlighted = component["activeIndex"];
    component.options = options();
    component.ngOnChanges({options: new SimpleChange(null, component.options, false)});
    expect(highlighted).toBe(2);
    expect(component["activeIndex"]).toBe(2);
  });
});
