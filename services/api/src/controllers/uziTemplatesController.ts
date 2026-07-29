import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";
import { ApiError } from "../middleware/errorHandler";

/** doctorId приходит query-параметром: бланки привязаны к врачу, а не к пользователю. */
const readDoctorId = (req: Request): number => {
  const raw = req.query.doctorId;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, "doctorId is required");
  }
  return value;
};

export const listUziTemplatesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const result = await services.uziTemplates.list(auth, readDoctorId(req));
  return res.status(200).json(result);
};

export const getUziTemplateController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const template = await services.uziTemplates.getById(
    auth,
    readDoctorId(req),
    String(req.params.templateId ?? "")
  );
  return res.status(200).json(template);
};
