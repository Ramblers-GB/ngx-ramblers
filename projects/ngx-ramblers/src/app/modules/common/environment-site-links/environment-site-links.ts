import { Component, Input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faArrowRightArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { TooltipDirective } from "ngx-bootstrap/tooltip";
import { coerceBooleanProperty } from "@angular/cdk/coercion";
import { kebabCase } from "es-toolkit/compat";
import { EnvironmentSiteLink } from "../../../models/environment-config.model";
import { AdminPlatformPath } from "../../../models/admin-route-paths.model";
import { EnvironmentMigrationTab } from "../../../models/environment-migration.model";
import { StoredValue } from "../../../models/ui-actions.model";

@Component({
  selector: "app-environment-site-links",
  imports: [RouterLink, FontAwesomeModule, TooltipDirective],
  styles: [`
    .site-move-link
      margin-left: 0.3rem
      color: var(--bs-secondary-color)
    .site-move-link:hover, .site-move-link:focus-visible
      color: var(--ramblers-colour-sunrise, #f9b104)
  `],
  template: `
    @for (site of sites; track site.environment; let last = $last) {
      <span class="text-nowrap">
        @if (site.url) {
          <a [href]="site.url" target="_blank" rel="noopener" [attr.aria-label]="'Open ' + site.environment + ' in a new tab'">{{ site.environment }}</a>
        } @else {
          <span>{{ site.environment }}</span>
        }
        @if (moveLinks) {
          <a class="site-move-link" [routerLink]="'/' + AdminPlatformPath.ENVIRONMENT_MANAGEMENT_MIGRATION" [queryParams]="migrationQueryParams(site)"
             [tooltip]="'Move ' + site.environment + ' to another database server'" container="body"
             [attr.aria-label]="'Move ' + site.environment + ' to another database server'"><fa-icon [icon]="faArrowRightArrowLeft"/></a>
        }
        @if (!last) {
          <span>,</span>
        }
      </span>
      @if (!last) {
        <span> </span>
      }
    } @empty {
      <span>—</span>
    }
  `
})
export class EnvironmentSiteLinksComponent {
  @Input() sites: EnvironmentSiteLink[] = [];
  moveLinks = false;

  @Input("moveLinks")
  set moveLinksValue(value: boolean) {
    this.moveLinks = coerceBooleanProperty(value);
  }

  protected readonly AdminPlatformPath = AdminPlatformPath;
  protected readonly faArrowRightArrowLeft = faArrowRightArrowLeft;

  protected migrationQueryParams(site: EnvironmentSiteLink): Record<string, string> {
    return {[StoredValue.ENVIRONMENT]: site.environment, [StoredValue.TAB]: kebabCase(EnvironmentMigrationTab.PLAN)};
  }
}
