import expect from "expect";
import { describe, it } from "mocha";
import { seedDefaultLogoBanner } from "./seed-default-banner";

function fakeDb(state: {banners: any[]; system: any}) {
  return {
    collection(name: string) {
      if (name === "config") {
        return {findOne: async () => state.system};
      } else {
        return {
          countDocuments: async () => state.banners.length,
          findOne: async (query: {fileNameData?: { $exists: boolean }; name?: string}) => {
            return state.banners.find(banner => {
              const nameMatches = !query?.name || banner.name === query.name;
              const missingPicture = query?.fileNameData ? !banner.fileNameData : true;
              return nameMatches && missingPicture;
            }) || null;
          },
          insertOne: async (doc: any) => {
            state.banners.push({_id: "new", ...doc});
          },
          updateOne: async (query: {_id: string}, update: {$set: any}) => {
            const banner = state.banners.find(item => item._id === query._id);
            Object.assign(banner, update.$set);
          }
        };
      }
    }
  } as any;
}

const hillsideLogo = {originalFileName: "group-horizontal-hillside.jpg", awsFileName: "logos/group-horizontal-hillside.jpg", width: 300};

describe("seedDefaultLogoBanner", () => {
  it("inserts a default banner when the collection is empty", async () => {
    const state = {
      banners: [],
      system: {key: "system", value: {group: {longName: "Hillside Park"}, logos: {images: [hillsideLogo]}, header: {selectedLogo: hillsideLogo.originalFileName}}}
    };
    const result = await seedDefaultLogoBanner(fakeDb(state));
    expect(result.seeded).toBe(true);
    expect(state.banners.length).toBe(1);
    expect(state.banners[0].name).toBe("Hillside Park Full Width Banner");
  });

  it("leaves existing complete banners in place", async () => {
    const state = {
      banners: [{_id: "1", name: "Existing", fileNameData: {awsFileName: "bannerPhotos/a.jpeg"}}],
      system: {key: "system", value: {logos: {images: [hillsideLogo]}}}
    };
    const result = await seedDefaultLogoBanner(fakeDb(state));
    expect(result.seeded).toBe(false);
    expect(state.banners.length).toBe(1);
  });

  it("does not attach a picture to a custom banner that is missing one", async () => {
    const state = {
      banners: [{_id: "custom", name: "Committee header", fileNameData: undefined}],
      system: {key: "system", value: {group: {longName: "Hillside Park"}, logos: {images: [hillsideLogo]}, header: {selectedLogo: hillsideLogo.originalFileName}}}
    };
    const result = await seedDefaultLogoBanner(fakeDb(state));
    expect(result.seeded).toBe(false);
    expect(state.banners[0].fileNameData).toBeUndefined();
  });
});
