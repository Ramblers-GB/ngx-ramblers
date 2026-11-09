import { Component, inject, OnDestroy, OnInit } from "@angular/core";
import { take } from "es-toolkit/compat";
import { NgxLoggerLevel } from "ngx-logger";
import { Subscription } from "rxjs";
import { FontAwesomeModule } from "@fortawesome/angular-fontawesome";
import { faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { faFacebook } from "@fortawesome/free-brands-svg-icons";
import { FacebookPagePost, FacebookPageProfile, FacebookRecentPostsData } from "../../models/facebook.model";
import { SocialFeedItem, socialFeedStyle, SocialFeedStyle } from "../../models/social-feed.model";
import { ExternalSystems } from "../../models/system.model";
import { DateUtilsService } from "../../services/date-utils.service";
import { FacebookService } from "../../services/facebook.service";
import { Logger, LoggerFactory } from "../../services/logger-factory.service";
import { StringUtilsService } from "../../services/string-utils.service";
import { SystemConfigService } from "../../services/system/system-config.service";
import { CardContainerComponent } from "../../modules/common/card-container/card-container.component";
import { SocialFeedComponent } from "../../modules/common/social-feed/social-feed";
import { stripTrailingSlash } from "../../functions/strings";

@Component({
  selector: "app-facebook",
  template: `
    <app-card-container [icon]="faFacebook" [title]="accountName()" [subtitle]="followerSummary()"
                        [href]="pageHref()" [brandColour]="brandColour">
      @if (loading || feedItems.length > 0) {
        <app-social-feed [items]="feedItems" [style]="feedStyle" [loading]="loading"
                         [emptyIcon]="faFacebook" [brandColour]="brandColour"/>
      } @else if (loadError) {
        <div class="alert alert-warning d-flex align-items-start mb-0">
          <fa-icon [icon]="faCircleExclamation" class="flex-shrink-0 mt-1 me-2"/>
          <div>
            <strong class="d-block">Facebook feed unavailable</strong>
            {{ loadError }}
          </div>
        </div>
      } @else if (externalSystems?.facebook?.showFeed) {
        <div class="alert alert-warning d-flex align-items-start mb-0">
          <fa-icon [icon]="faCircleExclamation" class="flex-shrink-0 mt-1 me-2"/>
          <div>
            <strong class="d-block">No Facebook posts yet</strong>
            Connect a Facebook Page in System Settings, or check that the Page has public posts.
          </div>
        </div>
      }
    </app-card-container>
  `,
  imports: [CardContainerComponent, SocialFeedComponent, FontAwesomeModule]
})
export class FacebookComponent implements OnInit, OnDestroy {

  private logger: Logger = inject(LoggerFactory).createLogger("FacebookComponent", NgxLoggerLevel.ERROR);
  private facebookService = inject(FacebookService);
  private systemConfigService = inject(SystemConfigService);
  private dateUtils = inject(DateUtilsService);
  private stringUtils = inject(StringUtilsService);
  public feedItems: SocialFeedItem[] = [];
  public feedStyle: SocialFeedStyle = SocialFeedStyle.GRID;
  public profile: FacebookPageProfile;
  public externalSystems: ExternalSystems;
  public loading = false;
  public loadError = "";
  private loadInFlight = false;
  private readonly feedSize = 9;
  private subscriptions: Subscription[] = [];
  protected readonly faCircleExclamation = faCircleExclamation;
  protected readonly faFacebook = faFacebook;
  protected readonly brandColour = "#1877f2";

  ngOnInit() {
    this.subscriptions.push(this.systemConfigService.events().subscribe(item => {
      this.externalSystems = item.externalSystems;
      this.feedStyle = socialFeedStyle(this.externalSystems?.facebook?.feedStyle);
      this.logger.debug("system config event: facebook config:", this.externalSystems?.facebook);
      this.loadRecentPosts();
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  pageHref(): string {
    return this.externalSystems?.facebook?.groupUrl || this.profile?.link || "";
  }

  accountName(): string {
    return this.profile?.name || "Facebook";
  }

  followerSummary(): string {
    const followers = this.profile?.followersCount;
    return followers ? this.stringUtils.pluraliseWithCount(followers, "follower") : this.pageName();
  }

  private pageName(): string {
    const groupUrl = this.externalSystems?.facebook?.groupUrl;
    return groupUrl ? stripTrailingSlash(groupUrl).split("/").pop() : "";
  }

  private loadRecentPosts(): void {
    if (!this.externalSystems?.facebook?.showFeed) {
      this.logger.debug("showFeed is not enabled - clearing feed. facebook config:", this.externalSystems?.facebook);
      this.feedItems = [];
      this.loadError = "";
      this.loading = false;
    } else if (this.loadInFlight) {
      this.logger.debug("load already in flight - ignoring this config event");
    } else {
      this.loadInFlight = true;
      this.loading = true;
      this.loadError = "";
      this.facebookService.recentPosts()
        .then((recentPosts: FacebookRecentPostsData) => {
          const returned = recentPosts?.data || [];
          this.profile = recentPosts?.profile;
          this.feedItems = take(returned, this.feedSize).map(post => this.feedItem(post));
          this.logger.debug("recent posts response: returned:", returned.length, "displaying:", this.feedItems.length);
        })
        .catch(error => {
          this.feedItems = [];
          this.loadError = error?.error?.error || error?.message || "Could not load Facebook posts";
          this.logger.error("facebook recent posts failed:", this.loadError, error);
        })
        .finally(() => {
          this.loading = false;
          this.loadInFlight = false;
        });
    }
  }

  private feedItem(post: FacebookPagePost): SocialFeedItem {
    const when = post?.createdTime ? this.dateUtils.displayDate(post.createdTime) : "";
    const photos = post?.imageCount > 1 ? this.stringUtils.pluraliseWithCount(post.imageCount, "photo") : "";
    const caption = this.stringUtils.truncate((post?.message || "").trim(), 220);
    return {
      id: post.id,
      href: post.permalink,
      imageUrl: post.imageUrl,
      imageCount: post.imageCount,
      message: post.message,
      meta: [post?.authorName, post?.createdTime ? `Posted ${this.dateUtils.relativePastDayPhrase(post.createdTime)}` : ""].filter(Boolean).join(" · "),
      tooltip: [when, caption, photos].filter(Boolean).join(" - ")
    };
  }
}
