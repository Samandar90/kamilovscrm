import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn(async () => ({})) }));
vi.mock("../../../api/http", () => ({ requestJson }));

import { queueApi } from "./queueApi";
import type { QueueDisplayInput } from "./queueTypes";

beforeEach(() => requestJson.mockClear());

describe("staff queue API", () => {
  it("maps every call to its /api/queue endpoint, method and body", async () => {
    const signal = new AbortController().signal;
    const input: QueueDisplayInput = { name: "Холл", doctorIds: [3, 4], showNames: true, language: "uz_ru", voiceEnabled: true };

    await queueApi.today(7, signal);
    await queueApi.today();
    await queueApi.today(null);
    await queueApi.issue(11);
    await queueApi.call(11);
    await queueApi.callNext(3);
    await queueApi.ticket(11);
    await queueApi.listDisplays();
    await queueApi.createDisplay(input);
    await queueApi.updateDisplay(5, { showNames: false });
    await queueApi.deleteDisplay(5);
    await queueApi.rotateCode(5);

    expect(requestJson.mock.calls).toEqual([
      ["/api/queue/today?doctorId=7", { signal }],
      ["/api/queue/today", { signal: undefined }],
      ["/api/queue/today", { signal: undefined }],
      ["/api/queue/appointments/11/issue", { method: "POST" }],
      ["/api/queue/appointments/11/call", { method: "POST" }],
      ["/api/queue/doctors/3/call-next", { method: "POST" }],
      ["/api/queue/appointments/11/ticket"],
      ["/api/queue/displays"],
      ["/api/queue/displays", { method: "POST", body: input }],
      ["/api/queue/displays/5", { method: "PATCH", body: { showNames: false } }],
      ["/api/queue/displays/5", { method: "DELETE" }],
      ["/api/queue/displays/5/rotate-code", { method: "POST" }],
    ]);
  });
});
