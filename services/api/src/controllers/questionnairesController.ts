import type { Request, Response } from "express";
import { services } from "../container";
import { getAuthPayload } from "../utils/requestAuth";
import { parseQuestionnaireFilters } from "../validators/questionnairesValidators";

export const listQuestionnaireTemplatesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const includeInactive = req.query.includeInactive === "true";
  return res.status(200).json(await services.questionnaires.listTemplates(auth, includeInactive));
};

export const createQuestionnaireTemplateController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(201).json(await services.questionnaires.createTemplate(auth, req.body));
};

export const updateQuestionnaireTemplateController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res
    .status(200)
    .json(await services.questionnaires.updateTemplate(auth, Number(req.params.id), req.body));
};

export const listQuestionnairesController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.questionnaires.list(auth, parseQuestionnaireFilters(req.query)));
};

export const getQuestionnaireController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(200).json(await services.questionnaires.getById(auth, Number(req.params.id)));
};

export const createQuestionnaireController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res.status(201).json(await services.questionnaires.create(auth, req.body));
};

export const updateQuestionnaireController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  return res
    .status(200)
    .json(await services.questionnaires.updateAnswers(auth, Number(req.params.id), req.body));
};

export const deleteQuestionnaireController = async (req: Request, res: Response) => {
  const auth = getAuthPayload(req);
  const id = Number(req.params.id);
  await services.questionnaires.delete(auth, id);
  return res.status(200).json({ success: true, id });
};
