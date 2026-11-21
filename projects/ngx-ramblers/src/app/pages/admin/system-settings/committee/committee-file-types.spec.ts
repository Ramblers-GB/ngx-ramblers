import { CommitteeSettingsComponent } from "./committee-settings";
import { CommitteeConfig, CommitteeFileMeetingRole } from "../../../../models/committee.model";

describe("Committee file type editing", () => {
  const editor = () => {
    const component = Object.create(CommitteeSettingsComponent.prototype) as CommitteeSettingsComponent;
    component.committeeConfig = {fileTypes: []} as CommitteeConfig;
    return component;
  };

  it("adds only one unfinished row even when the add action is called repeatedly", () => {
    const component = editor();
    component.addFileType();
    component.addFileType();
    expect(component.committeeConfig.fileTypes.length).toBe(1);
    expect(component.hasIncompleteFileType()).toBe(true);
    component.committeeConfig.fileTypes[0].description = "Reports";
    component.addFileType();
    expect(component.committeeConfig.fileTypes.length).toBe(2);
  });

  it("requires a meeting category only when the new row is an agenda or minutes type", () => {
    const component = editor();
    component.addFileType();
    const fileType = component.committeeConfig.fileTypes[0];
    fileType.description = "Meeting papers";
    fileType.meetingRole = CommitteeFileMeetingRole.MINUTES;
    component.addFileType();
    expect(component.committeeConfig.fileTypes.length).toBe(1);
    fileType.meetingCategory = "Committee meeting";
    component.addFileType();
    expect(component.committeeConfig.fileTypes.length).toBe(2);
  });

  it("lets the user remove an unfinished row and start again", () => {
    const component = editor();
    component.addFileType();
    component.deleteFileType(component.committeeConfig.fileTypes[0]);
    expect(component.hasIncompleteFileType()).toBe(false);
    component.addFileType();
    expect(component.committeeConfig.fileTypes.length).toBe(1);
  });
});
