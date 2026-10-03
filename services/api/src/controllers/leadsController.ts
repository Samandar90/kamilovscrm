import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";

export const listLeadsController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.list(auth, req.query));
};

export const updateLeadController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.update(auth, Number(req.params.id), req.body));
};

export const getLeadPatientMatchesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.patientMatches(auth, Number(req.params.id)));
};

export const setLeadPatientController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.setPatient(auth, Number(req.params.id), req.body));
};

// ---------- Источники лидов (управление — только superadmin) ----------

export const listLeadSourcesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.listSources(auth));
};

export const manageLeadSourcesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.manageSources(auth));
};

export const createLeadSourceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(201).json(await services.leads.createSource(auth, req.body));
};

export const updateLeadSourceController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.updateSource(auth, Number(req.params.id), req.body));
};

// ---------- Таргетолог: только свои лиды ----------

/** Источник и клинику адрес не принимает: оба берутся из токена. */
export const listMyLeadsController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.leads.mine(auth, req.query));
};
