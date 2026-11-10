import expect from "expect";
import { describe, it } from "mocha";
import { FacebookAttachmentMediaType, FacebookGraphPost } from "../../../projects/ngx-ramblers/src/app/models/facebook.model";
import { albumIdFor, imageCountFor } from "./recent-posts";

function postWith(attachment: FacebookGraphPost["attachments"]): FacebookGraphPost {
  return {id: "post-1", attachments: attachment};
}

describe("facebook recent posts image counts", () => {
  it("uses the album count from Graph when the first page of subattachments is truncated", () => {
    const post = postWith({
      data: [{
        media_type: FacebookAttachmentMediaType.ALBUM,
        target: {id: "album-1"},
        subattachments: {data: Array.from({length: 12}, () => ({media: {image: {src: "https://example.com/p.jpg"}}}))}
      }]
    });
    expect(albumIdFor(post)).toEqual("album-1");
    expect(imageCountFor(post, {"album-1": 47})).toEqual(47);
  });

  it("falls back to the subattachment page when no album count is available", () => {
    const post = postWith({
      data: [{
        media_type: FacebookAttachmentMediaType.ALBUM,
        target: {id: "album-1"},
        subattachments: {data: Array.from({length: 12}, () => ({media: {image: {src: "https://example.com/p.jpg"}}}))}
      }]
    });
    expect(imageCountFor(post, {})).toEqual(12);
  });

  it("counts a single photo when there are no subattachments", () => {
    const post: FacebookGraphPost = {id: "post-2", full_picture: "https://example.com/one.jpg"};
    expect(imageCountFor(post)).toEqual(1);
  });

  it("treats a truncated subattachment page as an album when Graph supplies a next page", () => {
    const post = postWith({
      data: [{
        target: {id: "album-2"},
        subattachments: {
          data: Array.from({length: 12}, () => ({media: {image: {src: "https://example.com/p.jpg"}}})),
          paging: {next: "https://graph.facebook.com/next"}
        }
      }]
    });
    expect(albumIdFor(post)).toEqual("album-2");
    expect(imageCountFor(post, {"album-2": 86})).toEqual(86);
  });
});
