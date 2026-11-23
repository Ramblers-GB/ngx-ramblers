import { ExtendedGroupEvent } from "./group-event.model";

export interface WalksManagerUpdateResponse {
  changed: boolean;
  walk: ExtendedGroupEvent | null;
}
