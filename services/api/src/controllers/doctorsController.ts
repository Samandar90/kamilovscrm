import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

export const listDoctorsController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const doctors = await services.doctors.list(auth);
  return res.status(200).json(doctors);
};

export const getDoctorByIdController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const doctor = await services.doctors.getById(auth, Number(req.params.id));
  if (!doctor) throw new ApiError(404, "Doctor not found");
  return res.status(200).json(doctor);
};

export const createDoctorController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const {
    fullName,
    specialty,
    percent,
    phone,
    birth_date,
    active,
    serviceIds,
    name,
    speciality,
    room,
    queuePrefix,
  } = req.body ?? {};
  const created = await services.doctors.create(auth, {
    name: (name ?? fullName) as string,
    speciality: (speciality ?? specialty) as string,
    percent: Number(percent),
    phone: (phone ?? null) as string | null,
    birth_date: (birth_date ?? null) as string | null,
    active: Boolean(active),
    serviceIds: Array.isArray(serviceIds) ? serviceIds : [],
    room: (room ?? null) as string | null,
    queuePrefix: (queuePrefix ?? null) as string | null,
  });
  return res.status(201).json(created);
};

export const updateDoctorController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const {
    fullName,
    specialty,
    percent,
    phone,
    birth_date,
    active,
    serviceIds,
    name,
    speciality,
    room,
    queuePrefix,
  } = req.body ?? {};
  const payload = {
    ...(name !== undefined || fullName !== undefined ? { name: (name ?? fullName) as string } : {}),
    ...(speciality !== undefined || specialty !== undefined
      ? { speciality: (speciality ?? specialty) as string }
      : {}),
    ...(percent !== undefined ? { percent: Number(percent) } : {}),
    ...(phone !== undefined ? { phone: (phone ?? null) as string | null } : {}),
    ...(birth_date !== undefined ? { birth_date: (birth_date ?? null) as string | null } : {}),
    ...(active !== undefined ? { active: Boolean(active) } : {}),
    ...(serviceIds !== undefined && Array.isArray(serviceIds) ? { serviceIds } : {}),
    ...(room !== undefined ? { room: (room ?? null) as string | null } : {}),
    ...(queuePrefix !== undefined ? { queuePrefix: (queuePrefix ?? null) as string | null } : {}),
  };
  const updated = await services.doctors.update(auth, Number(req.params.id), payload);
  if (!updated) throw new ApiError(404, "Doctor not found");
  return res.status(200).json(updated);
};

export const deleteDoctorController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const deleted = await services.doctors.delete(auth, Number(req.params.id));
  if (!deleted) throw new ApiError(404, "Doctor not found");
  return res.status(200).json({ success: true, id: Number(req.params.id) });
};

