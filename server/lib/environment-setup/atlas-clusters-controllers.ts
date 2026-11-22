import { Request, Response } from "express";
import { isArray, isString } from "es-toolkit/compat";
import { createErrorDebugLog } from "../shared/error-debug-log";
import {
  allowAtlasNetworkAccess,
  atlasClusterView,
  createAtlasCluster,
  deleteAtlasCluster,
  saveAtlasProvisioning
} from "./atlas-clusters";
import { AtlasClusterCreateRequest, AtlasClusterTier } from "../../../projects/ngx-ramblers/src/app/models/atlas-cluster.model";
import { AtlasConfig, AwsRegion } from "../../../projects/ngx-ramblers/src/app/models/environment-config.model";
import { EmptyCollectionCandidate } from "../../../projects/ngx-ramblers/src/app/models/environment-collection-cleanup.model";
import { emptyCollectionCleanupPreview, removeEmptyCollections } from "./collection-cleanup";
import { deleteGhostDatabase, deleteLeftoverLogin } from "./atlas-ghost-databases";

const errorDebugLog = createErrorDebugLog("atlas-clusters-controllers");

export async function listAtlasClusters(_req: Request, res: Response): Promise<void> {
  try {
    const view = await atlasClusterView();
    res.json(view);
  } catch (error) {
    errorDebugLog("listAtlasClusters:", error?.message || error);
    res.status(500).json({error: error?.message || "Could not list Atlas clusters"});
  }
}

export async function createAtlasClusterRequest(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body || {};
    const request: AtlasClusterCreateRequest = {
      name: body.name,
      separateProject: body.separateProject === true,
      tier: body.tier || AtlasClusterTier.M0,
      region: body.region || AwsRegion.EU_WEST_2,
      setAsDefault: body.setAsDefault === true,
      allowAllNetworkAccess: body.allowAllNetworkAccess !== false
    };
    const result = await createAtlasCluster(request);
    res.status(201).json(result);
  } catch (error) {
    errorDebugLog("createAtlasCluster:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not create the cluster"});
  }
}

export async function deleteAtlasClusterRequest(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deleteAtlasCluster({projectId: req.params.projectId, name: req.params.name}));
  } catch (error) {
    errorDebugLog("deleteAtlasCluster:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not delete the cluster"});
  }
}

export async function allowAtlasNetworkAccessRequest(_req: Request, res: Response): Promise<void> {
  try {
    const result = await allowAtlasNetworkAccess();
    res.json(result);
  } catch (error) {
    errorDebugLog("allowAtlasNetworkAccess:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not update network access"});
  }
}

export async function saveAtlasProvisioningRequest(req: Request, res: Response): Promise<void> {
  try {
    const patch: Partial<AtlasConfig> = {};
    if (req.body?.projectId !== undefined) {
      patch.projectId = req.body.projectId;
    }
    if (req.body?.defaultCluster !== undefined) {
      patch.defaultCluster = req.body.defaultCluster;
    }
    const atlas = await saveAtlasProvisioning(patch);
    res.json({atlas});
  } catch (error) {
    errorDebugLog("saveAtlasProvisioning:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not save Atlas settings"});
  }
}

export async function collectionCleanupPreview(req: Request, res: Response): Promise<void> {
  try {
    res.json(await emptyCollectionCleanupPreview(isString(req.query.cluster) ? req.query.cluster : ""));
  } catch (error) {
    errorDebugLog("collectionCleanupPreview:", error?.message || error);
    res.status(500).json({error: error?.message || "Could not inspect empty collections"});
  }
}

export async function collectionCleanupRequest(req: Request, res: Response): Promise<void> {
  try {
    const selected = isArray(req.body?.candidates) ? req.body.candidates as EmptyCollectionCandidate[] : [];
    res.json(await removeEmptyCollections(isString(req.body?.cluster) ? req.body.cluster : "", selected));
  } catch (error) {
    errorDebugLog("collectionCleanupRequest:", error?.message || error);
    res.status(500).json({error: error?.message || "Could not remove empty collections"});
  }
}

export async function deleteGhostDatabaseRequest(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deleteGhostDatabase({migrationId: isString(req.body?.migrationId) ? req.body.migrationId : "", confirmDatabase: isString(req.body?.confirmDatabase) ? req.body.confirmDatabase : ""}));
  } catch (error) {
    errorDebugLog("deleteGhostDatabase:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not delete the database"});
  }
}

export async function deleteLeftoverLoginRequest(req: Request, res: Response): Promise<void> {
  try {
    res.json(await deleteLeftoverLogin({projectId: isString(req.body?.projectId) ? req.body.projectId : "", username: isString(req.body?.username) ? req.body.username : ""}));
  } catch (error) {
    errorDebugLog("deleteLeftoverLogin:", error?.message || error);
    res.status(400).json({error: error?.message || "Could not delete the login"});
  }
}
