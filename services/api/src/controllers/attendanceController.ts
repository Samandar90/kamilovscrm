import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

export const listAttendanceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const records = await services.attendance.listByDate(auth, req.query.date);
  return res.status(200).json(records);
};

export const attendanceSummaryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const rowsSummary = await services.attendance.summary(auth, req.query.month);
  return res.status(200).json(rowsSummary);
};

export const upsertAttendanceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const record = await services.attendance.upsert(auth, req.body ?? {});
  return res.status(200).json(record);
};

export const removeAttendanceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const removed = await services.attendance.remove(auth, req.params.userId, req.params.workDate);
  return res.status(200).json({ success: removed });
};
