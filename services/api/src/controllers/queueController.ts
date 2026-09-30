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

// ---------- ТВ-экраны очереди (управление — только superadmin) ----------

export const listQueueDisplaysController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.list(auth));
};

export const createQueueDisplayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(201).json(await services.queueDisplays.create(auth, req.body));
};

export const updateQueueDisplayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.update(auth, Number(req.params.id), req.body));
};

export const deleteQueueDisplayController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.remove(auth, Number(req.params.id)));
};

export const rotateQueueDisplayCodeController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.queueDisplays.rotate(auth, Number(req.params.id)));
};

/** Публичный ТВ-эндпоинт: без авторизации. no-store ставится до сервиса, чтобы и 404/403 не кэшировались. */
export const getPublicQueueDisplayController = async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  return res.status(200).json(await services.queueDisplays.publicState(String(req.params.code ?? "")));
};
