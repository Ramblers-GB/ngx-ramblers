export enum SocialFeedStyle {
  GRID = "grid",
  LIST = "list"
}

export interface SocialFeedItem {
  id: string;
  href: string;
  imageUrl: string;
  imageCount: number;
  message: string;
  meta: string;
  tooltip: string;
}

export const SOCIAL_FEED_STYLE_OPTIONS: { label: string; value: SocialFeedStyle }[] = [
  {label: "Photo grid", value: SocialFeedStyle.GRID},
  {label: "Post list", value: SocialFeedStyle.LIST}
];

export function socialFeedStyle(style?: SocialFeedStyle | null): SocialFeedStyle {
  if (style === SocialFeedStyle.LIST) {
    return SocialFeedStyle.LIST;
  } else {
    return SocialFeedStyle.GRID;
  }
}
