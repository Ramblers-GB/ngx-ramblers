import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { take } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import { Subscription } from "rxjs";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { faInstagram } from "@fortawesome/free-brands-svg-icons";
import { InstagramMediaPost, InstagramProfile, InstagramRecentMediaData } from "../../models/instagram.model";
import { SocialFeedItem, socialFeedStyle, SocialFeedStyle } from "../../models/social-feed.model";
import { ExternalSystems } from "../../models/system.model";
import { DateUtilsService } from "../../services/date-utils.service";
import { InstagramService } from "../../services/instagram.service";
import { Logger, LoggerFactory } from "../../services/logger-factory.service";
import { StringUtilsService } from "../../services/string-utils.service";
import { SystemConfigService } from "../../services/system/system-config.service";
import { CardContainerComponent } from "../../modules/common/card-container/card-container.component";
import { SocialFeedComponent } from "../../modules/common/social-feed/social-feed";
import { stripTrailingSlash } from "../../functions/strings";

@Component({
  selector: "app-instagram",
  template: `
    <app-card-container [icon]="faInstagram" [title]="accountName()" [subtitle]="followerSummary()"
                        [href]="profileHref()" [brandColour]="brandColour">
      @if (loading || feedItems.length > 0) {
        <app-social-feed [items]="feedItems" [style]="feedStyle" [loading]="loading"
                         [emptyIcon]="faInstagram" [brandColour]="brandColour"/>
      } @else if (loadError) {
        <div class="alert alert-warning d-flex align-items-start mb-0">
          <fa-icon [icon]="faCircleExclamation" class="flex-shrink-0 mt-1 me-2"/>
          <div>
            <strong class="d-block">Instagram feed unavailable</strong>
            {{ loadError }}
          </div>
        </div>
      } @else if (externalSystems?.instagram?.showFeed) {
        <div class="alert alert-warning d-flex align-items-start mb-0">
          <fa-icon [icon]="faCircleExclamation" class="flex-shrink-0 mt-1 me-2"/>
          <div>
            <strong class="d-block">No Instagram posts yet</strong>
            Connect Facebook with a linked Instagram account in System Settings, or check that the account has public posts.
          </div>
        </div>
      }
    </app-card-container>
  `,
  imports: [CardContainerComponent, SocialFeedComponent, FontAwesomeModule]
})
export class InstagramComponent implements OnInit, OnDestroy {

  private logger: Logger = inject(LoggerFactory).createLogger("InstagramComponent", NgxLoggerLevel.ERROR);
  private instagramService = inject(InstagramService);
  private systemConfigService = inject(SystemConfigService);
  private dateUtils = inject(DateUtilsService);
  private stringUtils = inject(StringUtilsService);
  public feedItems: SocialFeedItem[] = [];
  public feedStyle: SocialFeedStyle = SocialFeedStyle.GRID;
  public profile: InstagramProfile;
  public externalSystems: ExternalSystems;
  public loading = false;
  public loadError = "";
  private loadInFlight = false;
  private readonly feedSize = 9;
  private subscriptions: Subscription[] = [];
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly faInstagram = faInstagram;
  protected readonly brandColour = "#e4405f";

  ngOnInit() {
    this.logger.debug("ngOnInit");
    this.subscriptions.push(this.systemConfigService.events().subscribe(item => {
      this.externalSystems = item.externalSystems;
      this.feedStyle = socialFeedStyle(this.externalSystems?.instagram?.feedStyle);
      this.logger.debug("system config event: instagram config:", this.externalSystems?.instagram);
      this.loadRecentMedia();
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  profileHref(): string {
    const groupUrl = stripTrailingSlash(this.externalSystems?.instagram?.groupUrl);
    const groupName = (this.externalSystems?.instagram?.groupName || "").replace(/^@/, "").replace(/^\/+/, "");
    if (groupUrl && groupName && !groupUrl.toLowerCase().includes(groupName.toLowerCase())) {
      return `${groupUrl}/${groupName}`;
    } else if (groupUrl) {
      return groupUrl;
    } else if (groupName) {
      return `https://www.instagram.com/${groupName}`;
    } else {
      return "";
    }
  }

  private loadRecentMedia(): void {
    if (!this.externalSystems?.instagram?.showFeed) {
      this.logger.debug("showFeed is not enabled - clearing feed. instagram config:", this.externalSystems?.instagram);
      this.feedItems = [];
      this.loadError = "";
      this.loading = false;
    } else if (this.loadInFlight) {
      this.logger.debug("load already in flight - ignoring this config event");
    } else {
      this.loadInFlight = true;
      this.loading = true;
      this.loadError = "";
      this.logger.debug("requesting recent media");
      this.instagramService.recentMedia()
        .then((recentMedia: InstagramRecentMediaData) => {
          const returned = recentMedia?.data || [];
          this.profile = recentMedia?.profile;
          this.feedItems = take(returned.filter(item => item?.media_url), this.feedSize).map(media => this.feedItem(media));
          this.logger.debug("recent media response: returned:", returned.length, "displaying:", this.feedItems.length, "data:", recentMedia);
        })
        .catch(error => {
          this.feedItems = [];
          this.loadError = error?.error?.error || error?.message || "Could not load Instagram posts";
          this.logger.error("instagram recent media failed:", this.loadError, error);
        })
        .finally(() => {
          this.loading = false;
          this.loadInFlight = false;
          this.logger.debug("load complete: loading:", this.loading, "loadError:", this.loadError, "feedItems:", this.feedItems.length, "showFeed:", this.externalSystems?.instagram?.showFeed);
        });
    }
  }

  accountName(): string {
    return this.externalSystems?.instagram?.groupName || this.profile?.username || "Instagram";
  }

  followerSummary(): string {
    const followers = this.profile?.followersCount;
    const posts = this.profile?.mediaCount;
    return [
      followers ? `${followers.toLocaleString()} ${followers === 1 ? "follower" : "followers"}` : "",
      posts ? `${posts.toLocaleString()} posts` : ""
    ].filter(Boolean).join(" · ");
  }

  private feedItem(media: InstagramMediaPost): SocialFeedItem {
    const when = media?.timestamp ? this.dateUtils.displayDate(media.timestamp) : "";
    const caption = this.stringUtils.truncate((media?.caption || "").trim(), 220);
    return {
      id: media.id,
      href: media.permalink,
      imageUrl: media.media_url,
      imageCount: 1,
      message: media.caption,
      meta: media?.timestamp ? `Posted ${this.dateUtils.relativePastDayPhrase(media.timestamp)}` : "",
      tooltip: [when, caption].filter(Boolean).join(" - ")
    };
  }
}
