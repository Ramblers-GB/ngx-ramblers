import { Component, Input } from "@angular/core";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faImages } from "@fortawesome/free-solid-svg-icons";
import { TooltipDirective } from "ngx-bootstrap/tooltip";
import { SocialFeedItem, SocialFeedStyle } from "../../../models/social-feed.model";

@Component({
  selector: "app-social-feed",
  template: `
    @if (loading) {
      @if (style === SocialFeedStyle.LIST) {
        <div class="social-feed-list" aria-busy="true" aria-label="Loading recent posts">
          @for (placeholder of skeletonTiles; track placeholder) {
            <div class="social-feed-list-skeleton">
              <div class="social-feed-skeleton-thumb"></div>
              <div class="social-feed-skeleton-lines">
                <div class="social-feed-skeleton-line"></div>
                <div class="social-feed-skeleton-line short"></div>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="social-feed-grid social-feed-grid-skeleton" aria-busy="true" aria-label="Loading recent posts">
          @for (placeholder of skeletonTiles; track placeholder) {
            <div class="social-feed-skeleton-tile"></div>
          }
        </div>
      }
    } @else if (style === SocialFeedStyle.LIST) {
      <div class="social-feed-list" [style.--social-feed-brand]="brandColour">
        @for (item of items; track item.id) {
          <a class="social-feed-list-item" [href]="item.href" target="_blank" rel="noopener noreferrer"
             delay="500" [tooltip]="item.tooltip" [placement]="'top'"
             containerClass="social-media-tooltip">
            @if (item.imageUrl) {
              <span class="social-feed-thumb">
                <img [src]="item.imageUrl" [alt]="item.message || 'Social post'"/>
                @if (item.imageCount > 1) {
                  <span class="social-feed-count">
                    <fa-icon [icon]="faImages"/>
                    {{ item.imageCount }}
                  </span>
                }
              </span>
            } @else {
              <span class="social-feed-thumb social-feed-thumb-empty">
                <fa-icon [icon]="emptyIcon"/>
              </span>
            }
            <span class="social-feed-copy">
              <span class="social-feed-message">{{ item.message }}</span>
              <span class="social-feed-meta">{{ item.meta }}</span>
            </span>
          </a>
        }
      </div>
    } @else {
      <div class="social-feed-grid">
        @for (item of items; track item.id) {
          <a [href]="item.href" target="_blank" rel="noopener noreferrer"
             delay="500" [tooltip]="item.tooltip" [placement]="'top'"
             containerClass="social-media-tooltip">
            @if (item.imageUrl) {
              <img [src]="item.imageUrl" [alt]="item.message || 'Social post'"/>
            } @else {
              <span class="social-feed-thumb-empty social-feed-grid-empty">
                <fa-icon [icon]="emptyIcon"/>
              </span>
            }
            @if (item.imageCount > 1) {
              <span class="social-feed-count">
                <fa-icon [icon]="faImages"/>
                {{ item.imageCount }}
              </span>
            }
          </a>
        }
      </div>
    }
  `,
  styleUrls: ["./social-feed.sass"],
  imports: [FontAwesomeModule, TooltipDirective]
})
export class SocialFeedComponent {
  @Input() items: SocialFeedItem[] = [];
  @Input() style: SocialFeedStyle = SocialFeedStyle.GRID;
  @Input() loading = false;
  @Input() emptyIcon: IconDefinition;
  @Input() brandColour: string;
  protected readonly SocialFeedStyle = SocialFeedStyle;
  protected readonly faImages = faImages;
  protected readonly skeletonTiles = Array.from({length: 9}, (ignored, index) => index);
}
