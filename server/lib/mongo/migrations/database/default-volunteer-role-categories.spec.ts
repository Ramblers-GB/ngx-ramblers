import { Db } from "mongodb";
import expect from "expect";
import { describe, it } from "mocha";
import sinon from "sinon";
import { up } from "./20261121150000-default-volunteer-role-categories";
import { CONFIG_COLLECTION, MEMBERS_COLLECTION } from "../shared/collection-names";

function databaseWith(systemValue: object, members: object[]) {
  const config = {
    findOne: sinon.stub().resolves({key: "system", value: systemValue}),
    updateOne: sinon.stub().resolves({})
  };
  const memberCollection = {find: sinon.stub().returns({toArray: sinon.stub().resolves(members)})};
  const collection = sinon.stub();
  collection.withArgs(CONFIG_COLLECTION).returns(config);
  collection.withArgs(MEMBERS_COLLECTION).returns(memberCollection);
  return {db: {collection} as unknown as Db, config};
}

describe("default volunteer role categories migration", () => {
  const knownCategories = [
    {name: "Rights of way volunteers", roles: ["Group Coordinator", "Local Footpath Officer", "Parish Footpath Observer"]},
    {name: "Rights of way contacts", roles: ["Rights of Way Contact (organisation)"]},
    {name: "Footpaths and rights of way", roles: ["Acting Public Rights of Way Manager", "Footpath Officer", "Footpath Warden", "Public Rights of Way Manager"]},
    {name: "Membership", roles: ["Area Membership Recruitment Coordinator", "Area Membership Secretary", "Membership Secretary Support"]},
    {name: "Communications", roles: ["Area Newsletter Editor", "Area Publicity Officer", "Area Webpage Editor", "Web Editor"]},
    {name: "Environment", roles: ["Area Environmental Protection Volunteer", "Area Solar Arrays Coordinator"]},
    {name: "Committee", roles: ["Area Chair", "Area Committee Member", "Area Secretary", "Area Treasurer", "Area Vice Chairman"]}
  ];

  it("gives a site with no Team Emails data yet categories for every known Ramblers role", async () => {
    const {db, config} = databaseWith({}, []);
    await up(db, null);
    expect(config.updateOne.firstCall.args[1]).toEqual({$set: {"value.volunteers.roleCategories": knownCategories}});
  });

  it("adds roles the site already holds to the known ones", async () => {
    const {db, config} = databaseWith({}, [
      {volunteerRoles: "Walk Leader, Area Chair"},
      {volunteerRoles: "Parish Footpath Observer"}
    ]);
    await up(db, null);
    const categories = config.updateOne.firstCall.args[1].$set["value.volunteers.roleCategories"];
    expect(categories.find(category => category.name === "Walks")).toEqual({name: "Walks", roles: ["Walk Leader"]});
    expect(categories.find(category => category.name === "Rights of way volunteers")).toEqual(knownCategories[0]);
    expect(categories.find(category => category.name === "Committee").roles).toEqual(knownCategories[6].roles);
  });

  it("leaves categories a site has already set alone", async () => {
    const {db, config} = databaseWith({volunteers: {roleCategories: [{name: "Ours", roles: ["Area Chair"]}]}}, [
      {volunteerRoles: "Area Chair", salesforceId: "0033z000035FipvAAC"}
    ]);
    await up(db, null);
    expect(config.updateOne.called).toBe(false);
  });
});
