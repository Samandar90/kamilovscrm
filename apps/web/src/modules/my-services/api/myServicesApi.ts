import { requestJson } from "../../../api/http";
import type { Service } from "../../appointments/api/appointmentsFlowApi";

export type OwnServices = {
  /** Services the doctor provides (inactive ones stay visible so they can be removed). */
  assigned: Service[];
  /** Active clinic services the doctor can take on. */
  available: Service[];
};

export type OwnServiceInput = {
  name: string;
  price: number;
  duration: number;
};

/** /api/services/mine — a doctor manages the services patients can be booked for. */
export const myServicesApi = {
  list: (token: string) => requestJson<OwnServices>("/api/services/mine", { token }),

  add: (token: string, serviceId: number) =>
    requestJson<Service>("/api/services/mine", { method: "POST", token, body: { serviceId } }),

  // The API validates a category, but the clinic database has no category column: send the neutral one.
  create: (token: string, input: OwnServiceInput) =>
    requestJson<Service>("/api/services/mine/new", {
      method: "POST",
      token,
      body: { ...input, category: "other" },
    }),

  remove: (token: string, serviceId: number) =>
    requestJson<{ success: boolean }>(`/api/services/mine/${serviceId}`, { method: "DELETE", token }),
};
