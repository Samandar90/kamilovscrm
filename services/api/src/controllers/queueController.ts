import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

export const getQueueTodayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.today(auth, req.query));
};

export const issueQueueNumberController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.issue(auth, Number(req.params.id)));
};

export const callQueueEntryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.call(auth, Number(req.params.id)));
};

export const callNextQueueEntryController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.callNext(auth, Number(req.params.doctorId)));
};

export const getQueueTicketController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queue.ticket(auth, Number(req.params.id)));
};
