import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from "@angular/core";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import {
  TableFilterChip,
  TableFilterHeading,
  TableFilterOperator,
  TableFilterSuggestion,
  TableFilterSuggestionKind,
  TableTextFilterOption
} from "../../../models/table-text-filter.model";
import {
  tableFilterChips,
  tableFilterOperatorLabel,
  tableFilterOperatorNegated,
  tableFilterOperatorOpposite,
  tableFilterQueryFromChips,
  tableFilterSuggestions
} from "../../../functions/table-text-filter";

interface PendingChip {
  heading: string | null;
  operator: TableFilterOperator | null;
}

@Component({
  selector: "app-table-filter-select",
  imports: [FontAwesomeModule],
  styles: [`
    :host
      display: block
      position: relative
    .table-filter-box
      display: flex
      flex-wrap: wrap
      align-items: center
      gap: 0.35rem
      min-height: 2.5rem
      cursor: text
    .table-filter-box:focus-within
      border-color: var(--ramblers-colour-sunrise, #f9b104)
      box-shadow: 0 0 0 0.2rem rgba(249, 177, 4, 0.25)
    .table-filter-icon
      color: var(--bs-secondary-color)
    .table-filter-input
      flex: 1 1 10rem
      min-width: 8rem
      border: 0
      outline: 0
      background: transparent
      padding: 0.15rem 0
    .table-filter-chip
      display: inline-flex
      align-items: center
      gap: 0.25rem
      border: 1px solid rgba(155, 200, 171, 0.8)
      background: rgba(155, 200, 171, 0.18)
      border-radius: 1rem
      padding: 0.1rem 0.25rem 0.1rem 0.6rem
      font-size: 0.85rem
      line-height: 1.4
    .table-filter-chip.negated
      border-color: rgba(220, 53, 69, 0.45)
      background: rgba(220, 53, 69, 0.08)
    .table-filter-chip.pending
      border-style: dashed
      padding-right: 0.6rem
    .table-filter-chip-operator
      border: 0
      background: transparent
      padding: 0
      color: var(--bs-secondary-color)
      text-decoration: underline dotted
    .table-filter-chip-button
      border: 0
      background: transparent
      padding: 0 0.3rem
      color: var(--bs-secondary-color)
      line-height: 1
    .table-filter-chip-button:hover, .table-filter-chip-button:focus-visible, .table-filter-chip-operator:hover
      color: var(--ramblers-colour-sunrise, #f9b104)
    .table-filter-menu
      position: absolute
      z-index: 1050
      left: 0
      right: 0
      top: 100%
      margin-top: 0.25rem
      max-height: 22rem
      overflow-y: auto
      background: var(--bs-body-bg, white)
      border: 1px solid var(--bs-border-color)
      border-radius: 0.5rem
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12)
      padding: 0.25rem 0
    .table-filter-group
      padding: 0.4rem 0.9rem 0.2rem
      font-size: 0.72rem
      font-weight: 600
      text-transform: uppercase
      letter-spacing: 0.03em
      color: var(--bs-secondary-color)
    .table-filter-option
      display: flex
      justify-content: space-between
      gap: 1rem
      width: 100%
      border: 0
      background: transparent
      text-align: left
      padding: 0.35rem 0.9rem
    .table-filter-option.active
      background: rgba(155, 200, 171, 0.3)
    .table-filter-option-detail
      color: var(--bs-secondary-color)
      font-size: 0.8rem
      white-space: nowrap
    .table-filter-hint
      padding: 0.35rem 0.9rem 0.25rem
      font-size: 0.78rem
      color: var(--bs-secondary-color)
      border-top: 1px solid var(--bs-border-color)
      margin-top: 0.25rem
  `],
  template: `
    <div class="form-control table-filter-box" (click)="focusInput()">
      <fa-icon [icon]="faMagnifyingGlass" class="table-filter-icon"/>
      @for (chip of chips; track $index) {
        <span class="table-filter-chip" [class.negated]="negated(chip)">
          @if (chip.heading) {
            <span>{{ chip.heading }}</span>
          }
          <button type="button" class="table-filter-chip-operator"
                  [title]="'Switch to ' + operatorLabel(opposite(chip.operator))"
                  (click)="flipOperator($index, $event)">{{ chipOperatorLabel(chip) }}</button>
          <strong>{{ chip.value }}</strong>
          <button type="button" class="table-filter-chip-button" [attr.aria-label]="'Remove ' + chipText(chip)" (click)="removeChip($index, $event)">
            <fa-icon [icon]="faXmark" size="xs"/>
          </button>
        </span>
      }
      @if (pending.heading) {
        <span class="table-filter-chip pending">
          <span>{{ pending.heading }}</span>
          @if (pending.operator) {
            <span>{{ operatorLabel(pending.operator) }}</span>
          }
        </span>
      }
      <input #filterInput class="table-filter-input" type="text" autocomplete="off" role="combobox"
             [attr.aria-expanded]="menuOpen"
             [attr.aria-label]="placeholder"
             [placeholder]="chips.length || pending.heading ? '' : placeholder"
             [value]="typed"
             (input)="typedChanged($any($event.target).value)"
             (focus)="openMenu()"
             (blur)="closeMenuSoon()"
             (keydown)="keyDown($event)">
      @if (chips.length || pending.heading || typed) {
        <button type="button" class="table-filter-chip-button" aria-label="Clear filter" title="Clear filter" (click)="clearAll($event)">
          <fa-icon [icon]="faXmark"/>
        </button>
      }
    </div>
    @if (menuOpen && suggestions.length) {
      <div class="table-filter-menu" role="listbox">
        @for (suggestion of suggestions; track $index) {
          @if ($index === 0 || suggestions[$index - 1].group !== suggestion.group) {
            <div class="table-filter-group">{{ suggestion.group }}</div>
          }
          <button type="button" class="table-filter-option" role="option" [class.active]="$index === activeIndex"
                  [attr.aria-selected]="$index === activeIndex"
                  (mousedown)="$event.preventDefault()" (mouseenter)="activeIndex = $index" (click)="choose(suggestion)">
            <span>{{ suggestion.label }}</span>
            <span class="table-filter-option-detail">{{ suggestionDetail(suggestion) }}</span>
          </button>
        }
        <div class="table-filter-hint">↑ ↓ to move, Enter to choose, Backspace to undo the last step</div>
      </div>
    }
  `
})
export class TableFilterSelectComponent implements OnChanges {
  @Input() options: TableTextFilterOption[] = [];
  @Input() headings: TableFilterHeading[] = [];
  @Input() query = "";
  @Input() placeholder = "Filter: type to search, or pick a column";
  @Output() queryChange = new EventEmitter<string>();
  @ViewChild("filterInput") private filterInput: ElementRef<HTMLInputElement>;

  protected readonly faMagnifyingGlass = faMagnifyingGlass;
  protected readonly faXmark = faXmark;
  protected chips: TableFilterChip[] = [];
  protected pending: PendingChip = {heading: null, operator: null};
  protected typed = "";
  protected menuOpen = false;
  protected activeIndex = 0;
  protected suggestions: TableFilterSuggestion[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["query"] && this.query !== tableFilterQueryFromChips(this.chips)) {
      this.chips = tableFilterChips(this.query, this.headings.map(heading => heading.heading));
    }
    this.refreshSuggestions(false);
  }

  protected operatorLabel(operator: TableFilterOperator): string {
    return tableFilterOperatorLabel(operator);
  }

  protected opposite(operator: TableFilterOperator): TableFilterOperator {
    return tableFilterOperatorOpposite(operator);
  }

  protected negated(chip: TableFilterChip): boolean {
    return tableFilterOperatorNegated(chip.operator);
  }

  protected chipOperatorLabel(chip: TableFilterChip): string {
    if (chip.heading) {
      return tableFilterOperatorLabel(chip.operator);
    } else {
      return this.negated(chip) ? "without" : "has";
    }
  }

  protected chipText(chip: TableFilterChip): string {
    return [chip.heading, this.chipOperatorLabel(chip), chip.value].filter(Boolean).join(" ");
  }

  protected suggestionDetail(suggestion: TableFilterSuggestion): string {
    if (suggestion.kind === TableFilterSuggestionKind.VALUE) {
      const rows = `${suggestion.count} ${suggestion.count === 1 ? "row" : "rows"}`;
      return suggestion.detail ? `${suggestion.detail} · ${rows}` : rows;
    } else {
      return suggestion.detail;
    }
  }

  protected focusInput(): void {
    this.filterInput?.nativeElement.focus();
  }

  protected openMenu(): void {
    this.menuOpen = true;
    this.refreshSuggestions();
  }

  protected closeMenuSoon(): void {
    setTimeout(() => this.menuOpen = false, 120);
  }

  protected typedChanged(value: string): void {
    this.typed = value;
    this.menuOpen = true;
    this.refreshSuggestions();
  }

  protected keyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.menuOpen = true;
      this.activeIndex = Math.min(this.activeIndex + 1, this.suggestions.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = this.suggestions[this.activeIndex];
      if (suggestion) {
        this.choose(suggestion);
      }
    } else if (event.key === "Escape") {
      this.pending = {heading: null, operator: null};
      this.menuOpen = false;
      this.refreshSuggestions();
    } else if (event.key === "Backspace" && !this.typed) {
      this.stepBack();
    }
  }

  protected choose(suggestion: TableFilterSuggestion): void {
    if (suggestion.kind === TableFilterSuggestionKind.HEADING) {
      this.pending = {heading: suggestion.heading, operator: null};
      this.typed = "";
    } else if (suggestion.kind === TableFilterSuggestionKind.OPERATOR) {
      this.pending = {heading: suggestion.heading, operator: suggestion.operator};
      this.typed = "";
    } else {
      this.chips = [...this.chips, {heading: suggestion.heading, operator: suggestion.operator || TableFilterOperator.CONTAINS, value: suggestion.value}];
      this.pending = {heading: null, operator: null};
      this.typed = "";
      this.emit();
    }
    this.menuOpen = true;
    this.refreshSuggestions();
    this.focusInput();
  }

  protected flipOperator(index: number, event: Event): void {
    event.stopPropagation();
    this.chips = this.chips.map((chip, chipIndex) => chipIndex === index ? {...chip, operator: tableFilterOperatorOpposite(chip.operator)} : chip);
    this.emit();
  }

  protected removeChip(index: number, event: Event): void {
    event.stopPropagation();
    this.chips = this.chips.filter((_chip, chipIndex) => chipIndex !== index);
    this.emit();
  }

  protected clearAll(event: Event): void {
    event.stopPropagation();
    this.chips = [];
    this.pending = {heading: null, operator: null};
    this.typed = "";
    this.emit();
    this.refreshSuggestions();
  }

  private stepBack(): void {
    if (this.pending.operator) {
      this.pending = {...this.pending, operator: null};
    } else if (this.pending.heading) {
      this.pending = {heading: null, operator: null};
    } else if (this.chips.length) {
      this.chips = this.chips.slice(0, -1);
      this.emit();
    }
    this.refreshSuggestions();
  }

  private emit(): void {
    this.queryChange.emit(tableFilterQueryFromChips(this.chips));
  }

  private refreshSuggestions(fromStart = true): void {
    this.suggestions = tableFilterSuggestions({
      typed: this.typed,
      heading: this.pending.heading,
      operator: this.pending.operator,
      headings: this.headings,
      options: this.options
    });
    this.activeIndex = fromStart ? 0 : Math.min(this.activeIndex, Math.max(this.suggestions.length - 1, 0));
  }
}
