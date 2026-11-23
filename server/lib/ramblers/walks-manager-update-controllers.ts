import { Request, Response } from "express";
import { isEqual } from "es-toolkit/compat";
import { isValidObjectId } from "mongoose";
import debug from "debug";
import { EventPopulation } from "../../../projects/ngx-ramblers/src/app/models/system.model";
import { ExtendedGroupEvent, InputSource } from "../../../projects/ngx-ramblers/src/app/models/group-event.model";
import { RamblersEventType } from "../../../projects/ngx-ramblers/src/app/models/ramblers-walks-manager.model";
import { WalksManagerUpdateResponse } from "../../../projects/ngx-ramblers/src/app/models/walks-manager-update.model";
import { preserveUndisclosedWalksManagerContact } from "../../../projects/ngx-ramblers/src/app/functions/walks/ramblers-event.mapper";
import { systemConfig } from "../config/system-config";
import { extendedGroupEvent } from "../mongo/models/extended-group-event";
import { cacheEventIfNotFound, toExtendedGroupEvent } from "../walks/walks-manager-cache";
import { queryBasedOnExistingEvent } from "./list-events";
import { toObjectWithId } from "../mongo/controllers/transforms";
import { envConfig } from "../env-config/env-config";

const debugLog = debug(envConfig.logNamespace("walks-manager-update"));

export async function checkWalksManagerUpdate(req: Request, res: Response): Promise<void> {
  await processWalksManagerUpdate(req, res, false);
}

export async function updateFromWalksManager(req: Request, res: Response): Promise<void> {
  await processWalksManagerUpdate(req, res, true);
}

async function processWalksManagerUpdate(req: Request, res: Response, persist: boolean): Promise<void> {
  try {
    const config = await systemConfig();
    if (config?.group?.walkPopulation !== EventPopulation.WALKS_MANAGER) {
      res.status(409).json({error: "Walks Manager must be the walk data source"});
    } else if (!isValidObjectId(req.params.id)) {
      res.status(400).json({error: "Invalid walk identifier"});
    } else {
      const existing = await extendedGroupEvent.findById(req.params.id).lean().exec() as ExtendedGroupEvent;
      if (!existing) {
        res.status(404).json({error: "Walk not found"});
      } else if (existing.fields?.inputSource !== InputSource.WALKS_MANAGER_CACHE ||
        existing.groupEvent?.item_type !== RamblersEventType.GROUP_WALK || !existing.groupEvent?.id) {
        res.status(409).json({error: "This walk is not sourced from Walks Manager"});
      } else {
        const remote = await queryBasedOnExistingEvent(existing, {suppressEventLinking: true, types: [RamblersEventType.GROUP_WALK]}, config);
        const incoming = remote.response?.data?.find(event => event.id === existing.groupEvent.id && event.group_code === existing.groupEvent.group_code && event.item_type === RamblersEventType.GROUP_WALK);
        if (remote.apiStatusCode !== 200 || !incoming) {
          res.status(502).json({error: "The walk could not be retrieved from Walks Manager"});
        } else {
          const mapped = toExtendedGroupEvent(config, incoming);
          const comparable = preserveUndisclosedWalksManagerContact(existing.groupEvent, mapped.groupEvent);
          const storedGroupEvent = new extendedGroupEvent({groupEvent: existing.groupEvent}).toObject().groupEvent;
          const incomingGroupEvent = new extendedGroupEvent({groupEvent: comparable}).toObject().groupEvent;
          const changed = !isEqual(storedGroupEvent, incomingGroupEvent);
          if (persist && changed) {
            await cacheEventIfNotFound(config, incoming);
          }
          const walk = persist ? await extendedGroupEvent.findById(req.params.id).lean().exec() as ExtendedGroupEvent : null;
          const response: WalksManagerUpdateResponse = {changed, walk: toObjectWithId(walk)};
          res.json(response);
        }
      }
    }
  } catch (error) {
    debugLog("Walks Manager update failed", error);
    res.status(500).json({error: "Unable to update this walk from Walks Manager. Please try again."});
  }
}
