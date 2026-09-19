import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

export const listServicesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  let doctorId: number | undefined;
  if (req.query.doctorId !== undefined) {
    if (typeof req.query.doctorId !== "string") {
      throw new ApiError(400, "Query param 'doctorId' must be a positive integer");
    }
    const parsed = Number(req.query.doctorId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ApiError(400, "Query param 'doctorId' must be a positive integer");
    }
    doctorId = parsed;
  }
  const result = await services.services.list(auth, {
    doctorId,
  });
  return res.status(200).json(result);
};

export const getServiceByIdController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const entity = await services.services.getById(auth, Number(req.params.id));
  if (!entity) throw new ApiError(404, "Service not found");
  return res.status(200).json(entity);
};

export const createServiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const created = await services.services.create(auth, req.body);
  return res.status(201).json(created);
};

export const updateServiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const updated = await services.services.update(auth, Number(req.params.id), req.body);
  if (!updated) throw new ApiError(404, "Service not found");
  return res.status(200).json(updated);
};

export const deleteServiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const deleted = await services.services.delete(auth, Number(req.params.id));
  if (!deleted) throw new ApiError(404, "Service not found");
  return res.status(200).json({ success: true, id: Number(req.params.id) });
};

const parseServiceIdParam = (value: unknown, field: string): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `Field '${field}' must be a positive integer`);
  }
  return id;
};

export const listOwnServicesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.services.listOwn(auth));
};

export const addOwnServiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const serviceId = parseServiceIdParam(req.body?.serviceId, "serviceId");
  return res.status(200).json(await services.services.addOwn(auth, serviceId));
};

export const createOwnServiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(201).json(await services.services.createOwn(auth, req.body));
};

export const removeOwnServiceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const serviceId = parseServiceIdParam(req.params.serviceId, "serviceId");
  await services.services.removeOwn(auth, serviceId);
  return res.status(200).json({ success: true, id: serviceId });
};
