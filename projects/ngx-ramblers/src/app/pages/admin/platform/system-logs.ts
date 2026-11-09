import { Component } from "@angular/core";
import { PageComponent } from "../../../page/page.component";
import { SystemLogsSettingsComponent } from "../system-settings/diagnostics/system-logs-settings";

@Component({
  selector: "app-system-logs",
  imports: [PageComponent, SystemLogsSettingsComponent],
  template: `
    <app-page autoTitle pageTitle="System logs">
      <app-system-logs-settings/>
    </app-page>
  `
})
export class SystemLogsComponent {
}
