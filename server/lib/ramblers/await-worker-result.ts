import { dateTimeNowAsValue } from "../shared/dates";

export async function awaitWorkerResult<T>(read: () => Promise<T | null>, finished: (result: T) => boolean, deadline: number, pollMs: number): Promise<T | null> {
  const result = await read();
  if (result && finished(result)) {
    return result;
  } else if (dateTimeNowAsValue() >= deadline) {
    return result;
  } else {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    return awaitWorkerResult(read, finished, deadline, pollMs);
  }
}
