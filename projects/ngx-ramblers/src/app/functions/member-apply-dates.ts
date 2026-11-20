import { isNumber, isString } from "es-toolkit/compat";
import { DateTime } from "luxon";
import { UIDateFormat } from "../models/date-format.model";
import { MemberApplyDates } from "../models/member-bulk-apply.model";

const ZONE = "Europe/London";

function asDateTime(value: string | number, inputFormat?: string): DateTime {
  if (isNumber(value)) {
    return DateTime.fromMillis(value).setZone(ZONE);
  } else if (isString(value) && inputFormat) {
    return DateTime.fromFormat(value, inputFormat, {zone: ZONE});
  } else if (isString(value)) {
    return DateTime.fromISO(value, {zone: ZONE});
  } else {
    return DateTime.now().setZone(ZONE);
  }
}

export function memberApplyDates(): MemberApplyDates {
  return {
    asValueNoTime: (value, inputFormat) => asDateTime(value, inputFormat).startOf("day").toMillis(),
    displayDate: value => value ? asDateTime(value).toFormat(UIDateFormat.DISPLAY_DATE) : undefined,
    todayNoTime: () => DateTime.now().setZone(ZONE).startOf("day").toMillis(),
    monthsAgoNoTime: months => DateTime.now().setZone(ZONE).startOf("day").minus({months}).toMillis(),
    now: () => DateTime.now().setZone(ZONE).toMillis(),
  };
}
