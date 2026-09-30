import { describe, expect, it } from "vitest";
import { arrivalToastMessage } from "./arrivalToast";

const t = (key: string, options?: { code: string }) => (options ? `${key} ${JSON.stringify(options)}` : key);

describe("arrivalToastMessage", () => {
  it("announces the queue number the server issued with the arrival", () => {
    expect(arrivalToastMessage({ queueCode: "К-05" }, t)).toBe('appointments.queue.issued {"code":"К-05"}');
  });

  it("stays quiet when no number was issued (visit on another day, older API) or the answer is missing", () => {
    expect(arrivalToastMessage({ queueCode: null }, t)).toBeNull();
    expect(arrivalToastMessage({ queueCode: "  " }, t)).toBeNull();
    expect(arrivalToastMessage({}, t)).toBeNull();
    expect(arrivalToastMessage(null, t)).toBeNull();
  });
});
