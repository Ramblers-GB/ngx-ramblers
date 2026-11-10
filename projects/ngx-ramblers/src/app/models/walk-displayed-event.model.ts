import { DescribedChangedItem } from "./changed-item.model";

export interface DisplayedEvent {
  id: string;
  member: string;
  date: string;
  dateValue: number;
  eventType: string;
  changes: DescribedChangedItem[];
  notes?: string;
  data?: object;
}
