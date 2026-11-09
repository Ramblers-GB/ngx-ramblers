import { Component, Input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SOCIAL_FEED_STYLE_OPTIONS, socialFeedStyle, SocialFeedStyle } from "../../../models/social-feed.model";
import { ExternalSystem } from "../../../models/system.model";

@Component({
  selector: "app-social-feed-style-select",
  imports: [FormsModule],
  template: `
    <div class="form-group">
      <label [for]="selectId">Feed layout</label>
      <select class="form-control input-sm" [id]="selectId"
              [ngModel]="socialFeedStyle(externalSystem?.feedStyle)"
              (ngModelChange)="styleChange($event)">
        @for (option of options; track option.value) {
          <option [ngValue]="option.value">{{ option.label }}</option>
        }
      </select>
    </div>
  `
})
export class SocialFeedStyleSelectComponent {
  @Input() externalSystem: ExternalSystem;
  @Input() selectId = "social-feed-style";
  protected readonly options = SOCIAL_FEED_STYLE_OPTIONS;
  protected readonly socialFeedStyle = socialFeedStyle;

  styleChange(style: SocialFeedStyle): void {
    if (this.externalSystem) {
      this.externalSystem.feedStyle = style;
    }
  }
}
