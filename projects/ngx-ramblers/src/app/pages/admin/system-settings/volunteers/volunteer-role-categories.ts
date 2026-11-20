import { Component, inject, Input, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { TooltipDirective } from "ngx-bootstrap/tooltip";
import { NgxLoggerLevel } from "ngx-logger";
import { kebabCase } from "es-toolkit/compat";
import { Subscription } from "rxjs";
import { sortDirectionFromParam, sortDirectionParam } from "../../../../functions/sort-direction";
import { assignVolunteerRoleCategory, volunteerRoleCategoryFor, volunteerRoleCounts } from "../../../../functions/volunteer-roles";
import {
  SystemConfig,
  UNCATEGORISED_VOLUNTEER_ROLES_HEADING,
  VolunteerRoleCategoriesSubTab,
  VolunteerRoleCategory,
  VolunteerRoleCategoryField,
  VolunteerRoleCount,
  VolunteerRoleField,
  VolunteerRoleRow
} from "../../../../models/system.model";
import { ASCENDING } from "../../../../models/table-filtering.model";
import { StoredValue } from "../../../../models/ui-actions.model";
import { SortableTableCellDirective } from "../../../../modules/common/sortable-table/sortable-table-cell.directive";
import { SortableTableComponent } from "../../../../modules/common/sortable-table/sortable-table.component";
import { SortableTableAlignment, SortableTableColumn, SortableTableSortState } from "../../../../modules/common/sortable-table/sortable-table.model";
import { ThumbnailHeadingFrameComponent } from "../../../../modules/common/thumbnail-heading-frame/thumbnail-heading-frame";
import { SectionToggle } from "../../../../shared/components/section-toggle";
import { SectionToggleTab } from "../../../../models/section-toggle.model";
import { LoggerFactory } from "../../../../services/logger-factory.service";
import { MemberService } from "../../../../services/member/member.service";

@Component({
  selector: "app-volunteer-role-categories",
  imports: [FormsModule, FontAwesomeModule, TooltipDirective, SortableTableComponent, SortableTableCellDirective, ThumbnailHeadingFrameComponent, SectionToggle],
  template: `
    @if (config?.volunteers) {
      <app-thumbnail-heading-frame heading="Volunteer role categories" class="mb-3">
        <p class="mb-3">
          Volunteer roles arrive with each member's record. Put them under headings of your own and the
          Volunteer Roles filters in Member Admin are grouped the same way, in the order below. Roles left
          uncategorised stay under {{ UNCATEGORISED_VOLUNTEER_ROLES_HEADING }}. This only changes how roles are
          grouped on this site; member records are not touched.
        </p>
        <app-section-toggle [tabs]="subTabs" [(selectedTab)]="subTab"
                            [queryParamKey]="StoredValue.VOLUNTEER_ROLE_SUB_TAB"/>
        <div class="mb-3"></div>
        @if (subTab === VolunteerRoleCategoriesSubTab.CATEGORIES) {
          <div class="d-flex flex-wrap align-items-end gap-2 mb-3">
            <div class="flex-grow-1">
              <label for="new-volunteer-role-category">New category</label>
              <input id="new-volunteer-role-category" type="text" class="form-control"
                     [(ngModel)]="newCategoryName" (keyup.enter)="addCategory()"
                     placeholder="e.g. Rights of way volunteers">
            </div>
            <button class="btn btn-primary" type="button" [disabled]="!canAddCategory()" (click)="addCategory()">
              <fa-icon [icon]="faPlus" class="me-2"/>
              Add category
            </button>
          </div>
          <app-sortable-table [columns]="categoryColumns" [rows]="categories()" [reorderable]="true"
                              (reorder)="reorderCategories($event)"
                              emptyMessage="No categories yet. Add one to start grouping roles.">
            <ng-template [appSortableTableCell]="VolunteerRoleCategoryField.NAME" let-category>
              <input #categoryName class="form-control" aria-label="Category name" [value]="category.name"
                     (change)="renameCategory(category, categoryName)">
            </ng-template>
            <ng-template [appSortableTableCell]="VolunteerRoleCategoryField.ACTIONS" let-category>
              <button class="btn btn-quiet btn-icon" type="button" (click)="removeCategory(category)"
                      aria-label="Remove category" tooltip="Remove category">
                <fa-icon [icon]="faTrash"/>
              </button>
            </ng-template>
          </app-sortable-table>
        } @else {
          <app-sortable-table [columns]="roleColumns" [rows]="roleRows"
                              [defaultSortKey]="roleSortKey" [defaultSortDirection]="roleSortDirection"
                              [trackBy]="trackRole" (sortChange)="roleSortChanged($event)"
                              [emptyMessage]="loading ? 'Finding the volunteer roles held by members…' : 'No member has a volunteer role yet.'">
            <ng-template [appSortableTableCell]="VolunteerRoleField.CATEGORY" let-row>
              <select class="form-select" [attr.aria-label]="'Category for ' + row.role"
                      [ngModel]="row.category" (ngModelChange)="assignCategory(row.role, $event)">
                <option value="">{{ UNCATEGORISED_VOLUNTEER_ROLES_HEADING }}</option>
                @for (category of categories(); track $index) {
                  <option [value]="category.name">{{ category.name }}</option>
                }
              </select>
            </ng-template>
          </app-sortable-table>
        }
      </app-thumbnail-heading-frame>
    }
  `
})
export class VolunteerRoleCategories implements OnInit, OnDestroy {
  private logger = inject(LoggerFactory).createLogger("VolunteerRoleCategories", NgxLoggerLevel.ERROR);
  private memberService = inject(MemberService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private subscriptions: Subscription[] = [];
  private roleCounts: VolunteerRoleCount[] = [];
  protected readonly faPlus = faPlus;
  protected readonly faTrash = faTrash;
  protected readonly UNCATEGORISED_VOLUNTEER_ROLES_HEADING = UNCATEGORISED_VOLUNTEER_ROLES_HEADING;
  protected readonly VolunteerRoleField = VolunteerRoleField;
  protected readonly VolunteerRoleCategoryField = VolunteerRoleCategoryField;
  protected readonly VolunteerRoleCategoriesSubTab = VolunteerRoleCategoriesSubTab;
  protected readonly StoredValue = StoredValue;
  protected readonly subTabs: SectionToggleTab[] = [
    {value: VolunteerRoleCategoriesSubTab.ROLES, label: "Roles held by members"},
    {value: VolunteerRoleCategoriesSubTab.CATEGORIES, label: "Categories"}
  ];
  public subTab: string = VolunteerRoleCategoriesSubTab.CATEGORIES;
  protected readonly categoryColumns: SortableTableColumn<VolunteerRoleCategory>[] = [
    {key: VolunteerRoleCategoryField.NAME, label: "Category"},
    {key: VolunteerRoleCategoryField.ROLES, label: "Roles", align: SortableTableAlignment.RIGHT, cellGetter: category => category.roles?.length ?? 0},
    {key: VolunteerRoleCategoryField.ACTIONS, label: "", width: "56px"}
  ];
  protected readonly roleColumns: SortableTableColumn<VolunteerRoleRow>[] = [
    {key: VolunteerRoleField.ROLE, label: "Role", sortKey: VolunteerRoleField.ROLE, cellGetter: row => row.role},
    {key: VolunteerRoleField.MEMBER_COUNT, label: "Members", sortKey: VolunteerRoleField.MEMBER_COUNT, align: SortableTableAlignment.RIGHT, cellGetter: row => row.memberCount},
    {key: VolunteerRoleField.CATEGORY, label: "Category", sortKey: VolunteerRoleField.CATEGORY}
  ];
  @Input() config: SystemConfig;
  public newCategoryName = "";
  public roleRows: VolunteerRoleRow[] = [];
  public roleSortKey: string = VolunteerRoleField.ROLE;
  public roleSortDirection = ASCENDING;
  public loading = true;

  async ngOnInit() {
    this.subscriptions.push(this.activatedRoute.queryParams.subscribe(params => {
      const sortKey = this.roleColumns.find(column => kebabCase(column.sortKey) === params[StoredValue.VOLUNTEER_ROLE_SORT])?.sortKey;
      this.roleSortKey = sortKey ?? VolunteerRoleField.ROLE;
      this.roleSortDirection = sortDirectionFromParam(params[StoredValue.VOLUNTEER_ROLE_SORT_ORDER], ASCENDING);
    }));
    try {
      this.roleCounts = volunteerRoleCounts(await this.memberService.all({select: {volunteerRoles: 1}}));
      this.refreshRoleRows();
    } catch (error) {
      this.logger.error("ngOnInit:error", error);
    } finally {
      this.loading = false;
    }
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  categories(): VolunteerRoleCategory[] {
    return this.config?.volunteers?.roleCategories ?? [];
  }

  trackRole(_index: number, row: VolunteerRoleRow): string {
    return row.role;
  }

  canAddCategory(): boolean {
    return this.categoryNameAvailable(this.newCategoryName, null);
  }

  private categoryNameAvailable(name: string, renaming: VolunteerRoleCategory): boolean {
    const trimmed = (name || "").trim().toLowerCase();
    return !!trimmed && !this.categories().some(category => category !== renaming && category.name.trim().toLowerCase() === trimmed);
  }

  addCategory() {
    if (this.canAddCategory()) {
      this.updateCategories([...this.categories(), {name: this.newCategoryName.trim(), roles: []}]);
      this.newCategoryName = "";
    }
  }

  renameCategory(category: VolunteerRoleCategory, input: HTMLInputElement) {
    if (this.categoryNameAvailable(input.value, category)) {
      this.updateCategories(this.categories().map(existing => existing === category ? {...existing, name: input.value.trim()} : existing));
    } else {
      input.value = category.name;
    }
  }

  removeCategory(category: VolunteerRoleCategory) {
    this.updateCategories(this.categories().filter(existing => existing !== category));
  }

  reorderCategories(categories: VolunteerRoleCategory[]) {
    this.updateCategories(categories);
  }

  assignCategory(role: string, categoryName: string) {
    this.updateCategories(assignVolunteerRoleCategory(this.categories(), role, categoryName));
  }

  roleSortChanged(state: SortableTableSortState) {
    this.router.navigate([], {relativeTo: this.activatedRoute, queryParamsHandling: "merge", replaceUrl: true, queryParams: {
      [StoredValue.VOLUNTEER_ROLE_SORT]: kebabCase(state.key),
      [StoredValue.VOLUNTEER_ROLE_SORT_ORDER]: sortDirectionParam(state.direction)
    }});
  }

  private updateCategories(categories: VolunteerRoleCategory[]) {
    this.config.volunteers.roleCategories = categories;
    this.refreshRoleRows();
  }

  private refreshRoleRows() {
    this.roleRows = this.roleCounts.map(roleCount => ({...roleCount, category: volunteerRoleCategoryFor(this.categories(), roleCount.role)?.name ?? ""}));
  }
}
