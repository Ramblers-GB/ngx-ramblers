import debug from "debug";
import express, { Request, Response } from "express";
import { envConfig } from "../env-config/env-config";
import {
  ConvertedDocumentImage,
  DocumentConversionWorkerRequest,
  DocumentConversionWorkerResponse
} from "../../../projects/ngx-ramblers/src/app/models/integration-worker.model";
import { verifySignedJsonRequest } from "../ramblers/integration-worker-crypto";
import { convertBufferToMarkdown } from "./document-conversion";

const debugLog = debug(envConfig.logNamespace("document-conversion-worker-routes"));
debugLog.enabled = true;

const router = express.Router();

async function convertDocument(req: Request, res: Response): Promise<void> {
  if (!verifySignedJsonRequest(req)) {
    debugLog("POST /convert rejected: invalid signature");
    res.status(401).json({error: "Invalid document conversion request signature"});
    return;
  }
  const request: DocumentConversionWorkerRequest = req.body;
  if (!request?.fileName || !request?.fileBase64) {
    res.status(400).json({error: "fileName and fileBase64 are required"});
    return;
  }
  try {
    const buffer = Buffer.from(request.fileBase64, "base64");
    debugLog("POST /convert:", request.fileName, "size:", buffer.length);
    const images: ConvertedDocumentImage[] = [];
    const collectImage = async (image: {name: string; buffer: Buffer}) => {
      images.push({name: image.name, base64: image.buffer.toString("base64")});
      return `pdf-image:${image.name}`;
    };
    const result = await convertBufferToMarkdown(buffer, request.fileName, collectImage);
    const response: DocumentConversionWorkerResponse = {
      markdown: result.markdown,
      suggestedTitle: result.suggestedTitle,
      images
    };
    debugLog("POST /convert done:", request.fileName, "markdown:", result.markdown.length, "images:", images.length);
    res.json(response);
  } catch (error) {
    debugLog("POST /convert failed:", request.fileName, error);
    res.status(500).json({error: error instanceof Error ? error.message : "Document conversion failed"});
  }
}

router.post("/convert", convertDocument);

export const documentConversionWorkerRoutes = router;
