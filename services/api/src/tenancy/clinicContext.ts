import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "../middleware/errorHandler";

type Store = { clinicId: number };

const storage = new AsyncLocalStorage<Store>();

export const runWithClinicContext = <T>(clinicId: number, fn: () => T): T =>
  storage.run({ clinicId }, fn);

export const getClinicId = (): number | null => storage.getStore()?.clinicId ?? null;

export const requireClinicId = (): number => {
  const clinicId = getClinicId();
  if (!clinicId || !Number.isInteger(clinicId) || clinicId <= 0) {
    throw new ApiError(401, "Clinic context is missing");
  }
  return clinicId;
};

