import { Component, computed, input, model, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons";

@Component({
  selector: "app-search-input",
  imports: [FormsModule, FontAwesomeModule],
  styles: [`
    :host
      display: block
      min-width: 0

    .search-input-wrapper
      position: relative
      display: flex
      flex: 1 1 auto
      width: 1%
      min-width: 0

    .search-input-wrapper .form-control
      width: 100%
      padding-right: 2rem

    .search-input-clear
      position: absolute
      top: 0
      right: 0
      z-index: 5
      height: 100%
      width: 2rem
      display: inline-flex
      align-items: center
      justify-content: center
      padding: 0
      border: none
      background: transparent
      color: #999
      font-size: 18px
      line-height: 1
      cursor: pointer

    .search-input-clear:hover,
    .search-input-clear:focus
      color: #D0021B
      outline: none
  `],
  template: `
    <div class="input-group" [class.input-group-sm]="small()">
      <span class="input-group-text"><fa-icon [icon]="faSearch"/></span>
      <div class="search-input-wrapper">
        <input type="text" class="form-control"
               [attr.id]="inputId()"
               [ngModel]="value()"
               (ngModelChange)="value.set($event)"
               [disabled]="disabled()"
               [placeholder]="placeholder()">
        @if (clearVisible()) {
          <button type="button" class="search-input-clear" [attr.aria-label]="clearLabel()" [title]="clearLabel()"
                  [disabled]="disabled()"
                  (click)="clear()">
            <span aria-hidden="true">×</span>
          </button>
        }
      </div>
    </div>
  `
})
export class SearchInputComponent {
  value = model<string>("");
  placeholder = input<string>("Search");
  inputId = input<string | null>(null);
  small = input<boolean>(false);
  disabled = input<boolean>(false);
  forceClearVisible = input<boolean>(false);
  clearLabel = input<string>("Clear search");
  cleared = output<void>();

  protected readonly faSearch = faSearch;
  protected clearVisible = computed(() => !!this.value() || this.forceClearVisible());

  clear(): void {
    this.value.set("");
    this.cleared.emit();
  }
}
