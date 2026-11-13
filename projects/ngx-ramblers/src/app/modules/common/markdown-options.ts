import { marked } from "marked";
import { MarkedOptions, MarkedRenderer } from "ngx-markdown";
import { awsImageResourcePath, resourceAwsImageUrls } from "../../functions/aws-image-paths";
import { expandMarkdownTableRules } from "../../functions/email-composer-programme";
import { renderEmailComposerMarkdown } from "../../functions/email-composer-markdown";
import { nativeApiUrl } from "../../functions/native-walking";

export function markdownOptions(): MarkedOptions {
  const renderer = new MarkedRenderer();
  const renderImage = renderer.image;
  const renderHtml = renderer.html;
  const imagePath = (path: string) => nativeApiUrl(awsImageResourcePath(path));
  renderer.image = function(token) {
    const href = token?.href || "";
    return renderImage.call(this, {...token, href: imagePath(href)});
  };
  renderer.html = function(token) {
    const text = token?.text ?? token?.raw ?? "";
    return renderHtml.call(this, {...token, text: resourceAwsImageUrls(text, imagePath)});
  };
  return {renderer};
}

export function renderCommitteeDocumentMarkdown(markdown: string): string {
  if (!markdown) {
    return "";
  } else {
    try {
      return marked.parse(expandMarkdownTableRules(markdown), {...markdownOptions(), async: false}) as string;
    } catch {
      return renderEmailComposerMarkdown(expandMarkdownTableRules(markdown));
    }
  }
}
