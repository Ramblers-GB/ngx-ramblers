import { Db } from "mongodb";
import { ConfigKey } from "../../../../../projects/ngx-ramblers/src/app/models/config.model";
import { Image, RootFolder } from "../../../../../projects/ngx-ramblers/src/app/models/system.model";
import { createDefaultLogoAndTextBanner } from "../../../environment-setup/templates/sample-data/banner-template";
import { BannerPictureStore } from "../../../environment-setup/banner-picture.model";
import { renderLogoBannerPicture } from "../../../environment-setup/banner-picture";
import { ServerFileNameData } from "../../../../../projects/ngx-ramblers/src/app/models/aws-object.model";
import { v4 as uuid } from "uuid";
import { pluraliseWithCount } from "../../../shared/string-utils";

const BANNERS_COLLECTION = "banners";

async function bannerPicture(bannerName: string, logo: Image, pictureStore: BannerPictureStore | null): Promise<ServerFileNameData | null> {
  const logoContent = pictureStore && logo.awsFileName ? await pictureStore.read(logo.awsFileName) : null;
  if (!logoContent) {
    return null;
  } else {
    const awsFileName = `${uuid()}.jpeg`;
    await pictureStore.write(`${RootFolder.bannerPhotos}/${awsFileName}`, await renderLogoBannerPicture(logoContent), "image/jpeg");
    return {rootFolder: RootFolder.bannerPhotos, originalFileName: bannerName, awsFileName};
  }
}

function preferredLogo(systemConfigDoc: {value?: {logos?: {images?: Image[]}; header?: {selectedLogo?: string}; group?: {longName?: string}}} | null): {logo: Image; groupLongName: string} | null {
  const logos: Image[] = systemConfigDoc?.value?.logos?.images || [];
  const selectedLogoName = systemConfigDoc?.value?.header?.selectedLogo || "";
  const groupLongName = systemConfigDoc?.value?.group?.longName || "Group";
  const logo = logos.find(image => image?.originalFileName && image.originalFileName === selectedLogoName)
    || logos.find(image => !!image?.originalFileName && !!image?.awsFileName)
    || logos.find(image => !!image?.originalFileName)
    || null;
  if (!logo?.originalFileName) {
    return null;
  } else {
    return {logo, groupLongName};
  }
}

export async function seedDefaultLogoBanner(
  db: Db,
  log: (message: string) => void = () => {},
  pictureStore: BannerPictureStore | null = null
): Promise<{seeded: boolean; reason: string}> {
  const banners = db.collection(BANNERS_COLLECTION);
  const existingCount = await banners.countDocuments({});
  const outcome = {seeded: false, reason: ""};
  const systemConfigDoc = await db.collection("config").findOne({key: ConfigKey.SYSTEM});
  const chosen = preferredLogo(systemConfigDoc as any);

  if (existingCount > 0) {
    const defaultName = chosen ? createDefaultLogoAndTextBanner(chosen.groupLongName, chosen.logo).name : "";
    const withoutPicture = defaultName
      ? await banners.findOne({name: defaultName, fileNameData: {$exists: false}})
      : null;
    if (!withoutPicture) {
      outcome.reason = `Banners collection already has ${pluraliseWithCount(existingCount, "document")}`;
      log(outcome.reason);
    } else if (!chosen) {
      outcome.reason = "No logo available in system config to add a banner picture";
      log(outcome.reason);
    } else {
      const fileNameData = await bannerPicture(withoutPicture.name || chosen.groupLongName, chosen.logo, pictureStore);
      if (!fileNameData) {
        outcome.reason = `Banners collection already has ${pluraliseWithCount(existingCount, "document")} and the banner picture could not be written`;
        log(outcome.reason);
      } else {
        await banners.updateOne({_id: withoutPicture._id}, {$set: {fileNameData}});
        outcome.seeded = true;
        outcome.reason = `Added a banner picture to "${withoutPicture.name}" using logo ${chosen.logo.originalFileName}`;
        log(outcome.reason);
      }
    }
  } else if (!chosen) {
    outcome.reason = "No logo available in system config to seed a default banner";
    log(outcome.reason);
  } else {
    const banner = createDefaultLogoAndTextBanner(chosen.groupLongName, chosen.logo);
    const fileNameData = await bannerPicture(banner.name, chosen.logo, pictureStore);
    await banners.insertOne(fileNameData ? {...banner, fileNameData} : banner);
    outcome.seeded = true;
    outcome.reason = `Seeded default banner "${banner.name}" using logo ${chosen.logo.originalFileName}${fileNameData ? ", with its banner picture" : ""}`;
    log(outcome.reason);
  }
  return outcome;
}
