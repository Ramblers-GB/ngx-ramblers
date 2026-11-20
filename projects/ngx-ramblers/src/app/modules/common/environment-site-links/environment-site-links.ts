import { Component, Input } from "@angular/core";
import { EnvironmentSiteLink } from "../../../models/environment-config.model";

@Component({
  selector: "app-environment-site-links",
  template: `
    @for (site of sites; track site.environment; let last = $last) {
      @if (site.url) {
        <a [href]="site.url" target="_blank" rel="noopener" [attr.aria-label]="'Open ' + site.environment + ' in a new tab'">{{ site.environment }}</a>
      } @else {
        <span>{{ site.environment }}</span>
      }
      @if (!last) {
        <span>, </span>
      }
    } @empty {
      <span>—</span>
    }
  `
})
export class EnvironmentSiteLinksComponent {
  @Input() sites: EnvironmentSiteLink[] = [];
}
