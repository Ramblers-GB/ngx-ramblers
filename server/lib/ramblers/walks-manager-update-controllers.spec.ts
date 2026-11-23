import { afterEach, beforeEach, describe, it } from "mocha";
import expect from "expect";
import sinon from "sinon";
import { Request, Response } from "express";
import * as configService from "../config/system-config";
import * as events from "./list-events";
import * as cache from "../walks/walks-manager-cache";
import { extendedGroupEvent } from "../mongo/models/extended-group-event";
import { checkWalksManagerUpdate, updateFromWalksManager } from "./walks-manager-update-controllers";
import { EventPopulation, SystemConfig } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { ExtendedGroupEvent, GroupEvent, InputSource } from "../../../projects/ngx-ramblers/src/app/models/group-event.model";
import { RamblersEventType } from "../../../projects/ngx-ramblers/src/app/models/ramblers-walks-manager.model";
import { WalksManagerUpdateResponse } from "../../../projects/ngx-ramblers/src/app/models/walks-manager-update.model";

const localId = "000000000000000000000001";
const config = {group: {walkPopulation: EventPopulation.WALKS_MANAGER, groupCode: "HS01", longName: "Hillside Ramblers"}, area: {groupCode: "HS"}} as SystemConfig;
const remoteEvent = {id: "100000001", item_type: RamblersEventType.GROUP_WALK, group_code: "HS01", title: "Hillside Park", url: "https://group.example.org.uk/walks/hillside-park", start_date_time: "2027-01-20T10:00:00"} as GroupEvent;

describe("single walk update from Walks Manager", () => {
  const sandbox = sinon.createSandbox();
  const state = {existing: null as ExtendedGroupEvent, response: null as WalksManagerUpdateResponse, status: 200};
  const req = {params: {id: localId}} as unknown as Request;
  const res = {status: (code: number) => {state.status = code; return res;}, json: (body: WalksManagerUpdateResponse) => {state.response = body;}} as unknown as Response;

  beforeEach(() => {
    state.status = 200;
    state.response = null;
    state.existing = {...cache.toExtendedGroupEvent(config, {...remoteEvent}), _id: localId} as unknown as ExtendedGroupEvent;
    sandbox.stub(configService, "systemConfig").resolves(config);
    sandbox.stub(extendedGroupEvent, "findById").callsFake(() => ({lean: () => ({exec: async () => state.existing})}) as ReturnType<typeof extendedGroupEvent.findById>);
    sandbox.stub(events, "queryBasedOnExistingEvent").resolves({apiStatusCode: 200, response: {data: [{...remoteEvent, title: "Updated Hillside Park"}]}} as Awaited<ReturnType<typeof events.queryBasedOnExistingEvent>>);
    sandbox.stub(cache, "cacheEventIfNotFound").resolves(null);
  });

  afterEach(() => sandbox.restore());

  it("detects changes without saving during comparison", async () => {
    await checkWalksManagerUpdate(req, res);
    expect(state.response).toEqual({changed: true, walk: null});
    expect((cache.cacheEventIfNotFound as sinon.SinonStub).called).toBe(false);
  });

  it("uses the existing cache merge and returns the refreshed walk with its local id", async () => {
    await updateFromWalksManager(req, res);
    expect((cache.cacheEventIfNotFound as sinon.SinonStub).calledOnce).toBe(true);
    expect(state.response.walk.id).toBe(localId);
    expect(state.response.changed).toBe(true);
  });

  it("does not save identical data, including default empty arrays", async () => {
    (events.queryBasedOnExistingEvent as sinon.SinonStub).resolves({apiStatusCode: 200, response: {data: [{...remoteEvent}]}});
    state.existing = new extendedGroupEvent(state.existing).toObject();
    await updateFromWalksManager(req, res);
    expect(state.response.changed).toBe(false);
    expect((cache.cacheEventIfNotFound as sinon.SinonStub).called).toBe(false);
  });

  it("rejects sites using local walks before querying or saving", async () => {
    (configService.systemConfig as sinon.SinonStub).resolves({...config, group: {...config.group, walkPopulation: EventPopulation.LOCAL}});
    await updateFromWalksManager(req, res);
    expect(state.status).toBe(409);
    expect((events.queryBasedOnExistingEvent as sinon.SinonStub).called).toBe(false);
    expect((cache.cacheEventIfNotFound as sinon.SinonStub).called).toBe(false);
  });

  it("rejects manually created walks and mismatched remote groups", async () => {
    state.existing.fields.inputSource = InputSource.MANUALLY_CREATED;
    await updateFromWalksManager(req, res);
    expect(state.status).toBe(409);
    state.existing.fields.inputSource = InputSource.WALKS_MANAGER_CACHE;
    state.existing.groupEvent.group_code = "HS02";
    await updateFromWalksManager(req, res);
    expect(state.status).toBe(502);
    expect((cache.cacheEventIfNotFound as sinon.SinonStub).called).toBe(false);
  });

  it("supports an area site displaying a constituent group's walk", async () => {
    (configService.systemConfig as sinon.SinonStub).resolves({...config, group: {...config.group, groupCode: "HS"}});
    await checkWalksManagerUpdate(req, res);
    expect(state.status).toBe(200);
    expect(state.response.changed).toBe(true);
  });

  it("retains the saved walk when Walks Manager cannot return it", async () => {
    (events.queryBasedOnExistingEvent as sinon.SinonStub).resolves({apiStatusCode: 200, response: {data: []}});
    await updateFromWalksManager(req, res);
    expect(state.status).toBe(502);
    expect((cache.cacheEventIfNotFound as sinon.SinonStub).called).toBe(false);
  });
});
