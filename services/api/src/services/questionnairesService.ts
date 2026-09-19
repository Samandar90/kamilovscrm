import { ApiError } from "../middleware/errorHandler";
import { roleHasPermissionKey } from "../auth/permissions";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import type { IAppointmentsRepository } from "../repositories/interfaces/IAppointmentsRepository";
import type {
  IQuestionnairesRepository,
  PatientQuestionnaire,
  PatientQuestionnaireSummary,
  QuestionnaireFilters,
  QuestionnaireListResult,
  QuestionnaireTemplate,
  QuestionnaireTemplateInput,
} from "../repositories/interfaces/questionnaireTypes";
import {
  QUESTIONNAIRE_LIMITS,
  parseAnswers,
  parseOptionalText,
  parsePositiveId,
  parseQuestions,
  parseRequiredText,
} from "../validators/questionnairesValidators";
import { getEffectiveDoctorId, isDoctorScopedRole } from "./clinicalDataScope";

type Body = Record<string, unknown>;

const asBody = (body: unknown): Body =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};

/** The booking rule decides which patients a doctor (or their nurse) treats. */
type PatientScope = Pick<IAppointmentsRepository, "isPatientEligibleForDoctorBooking">;

const ownDoctorId = (auth: AuthTokenPayload): number => {
  if (auth.doctorId == null) {
    throw new ApiError(403, "Account is not linked to a doctor profile");
  }
  return auth.doctorId;
};

/**
 * Patient questionnaires: a shared base every clinical role of the clinic can read.
 * Doctors and nurses write only for patients they treat and do not get contact details,
 * as elsewhere in the CRM. A filled questionnaire snapshots its template.
 */
export class QuestionnairesService {
  constructor(
    private readonly repository: IQuestionnairesRepository,
    private readonly patientScope: PatientScope
  ) {}

  /** Inactive templates are only relevant to those who manage templates. */
  listTemplates(auth: AuthTokenPayload, includeInactive: boolean): Promise<QuestionnaireTemplate[]> {
    return this.repository.listTemplates({
      includeInactive: includeInactive && roleHasPermissionKey(auth.role, "QUESTIONNAIRE_TEMPLATE_MANAGE"),
    });
  }

  async createTemplate(auth: AuthTokenPayload, body: unknown): Promise<QuestionnaireTemplate> {
    const input = await this.parseTemplateInput(auth, asBody(body), null);
    return this.repository.createTemplate(input, auth.userId);
  }

  async updateTemplate(auth: AuthTokenPayload, id: number, body: unknown): Promise<QuestionnaireTemplate> {
    const current = await this.repository.findTemplate(id);
    if (!current) {
      throw new ApiError(404, "Шаблон анкеты не найден");
    }
    if (auth.role === "doctor") {
      const isOwn =
        current.createdBy === auth.userId || (auth.doctorId != null && current.doctorId === auth.doctorId);
      if (!isOwn) {
        throw new ApiError(403, "Врач может изменять только свои шаблоны анкет");
      }
    }
    const input = await this.parseTemplateInput(auth, asBody(body), current);
    const updated = await this.repository.updateTemplate(id, input, auth.userId);
    if (!updated) {
      throw new ApiError(404, "Шаблон анкеты не найден");
    }
    return updated;
  }

  async list(auth: AuthTokenPayload, filters: QuestionnaireFilters): Promise<QuestionnaireListResult> {
    const result = await this.repository.list(filters);
    return { ...result, items: result.items.map((item) => this.withoutContacts(auth, item)) };
  }

  async getById(auth: AuthTokenPayload, id: number): Promise<PatientQuestionnaire> {
    return this.withoutContacts(auth, await this.findOrFail(id));
  }

  async create(auth: AuthTokenPayload, rawBody: unknown): Promise<PatientQuestionnaire> {
    const body = asBody(rawBody);
    const patientId = parsePositiveId(body.patientId, "patientId");
    const templateId = parsePositiveId(body.templateId, "templateId");
    const appointmentId =
      body.appointmentId === undefined || body.appointmentId === null
        ? null
        : parsePositiveId(body.appointmentId, "appointmentId");

    const template = await this.repository.findTemplate(templateId);
    if (!template || !template.active) {
      throw new ApiError(404, "Шаблон анкеты не найден или отключён");
    }
    if (!(await this.repository.patientExists(patientId))) {
      throw new ApiError(404, "Пациент не найден");
    }
    await this.assertTreatsPatient(auth, patientId);

    let doctorId: number | null = isDoctorScopedRole(auth.role) ? getEffectiveDoctorId(auth) : null;
    if (appointmentId !== null) {
      const appointment = await this.repository.findAppointmentContext(appointmentId);
      if (!appointment || appointment.patientId !== patientId) {
        throw new ApiError(400, "Запись не относится к этому пациенту");
      }
      if (doctorId !== null && appointment.doctorId !== doctorId) {
        throw new ApiError(403, "Можно работать только с записями своего врача");
      }
      doctorId = appointment.doctorId;
    }

    const created = await this.repository.create(
      {
        patientId,
        templateId,
        title: template.title,
        questions: template.questions,
        answers: parseAnswers(body.answers, template.questions),
        appointmentId,
        doctorId: doctorId ?? template.doctorId,
      },
      auth.userId
    );
    return this.withoutContacts(auth, created);
  }

  async updateAnswers(auth: AuthTokenPayload, id: number, rawBody: unknown): Promise<PatientQuestionnaire> {
    const current = await this.findOrFail(id);
    await this.assertTreatsPatient(auth, current.patientId);
    const answers = parseAnswers(asBody(rawBody).answers, current.questions);
    const updated = await this.repository.updateAnswers(id, answers, auth.userId);
    if (!updated) {
      throw new ApiError(404, "Анкета не найдена");
    }
    return this.withoutContacts(auth, updated);
  }

  async delete(_auth: AuthTokenPayload, id: number): Promise<void> {
    if (!(await this.repository.softDelete(id))) {
      throw new ApiError(404, "Анкета не найдена");
    }
  }

  private async findOrFail(id: number): Promise<PatientQuestionnaire> {
    const found = await this.repository.findById(id);
    if (!found) {
      throw new ApiError(404, "Анкета не найдена");
    }
    return found;
  }

  private async assertTreatsPatient(auth: AuthTokenPayload, patientId: number): Promise<void> {
    if (!isDoctorScopedRole(auth.role)) return;
    const treats = await this.patientScope.isPatientEligibleForDoctorBooking(
      patientId,
      getEffectiveDoctorId(auth)
    );
    if (!treats) {
      throw new ApiError(403, "Анкеты можно заполнять и менять только для своих пациентов");
    }
  }

  private withoutContacts<T extends PatientQuestionnaireSummary>(auth: AuthTokenPayload, row: T): T {
    return isDoctorScopedRole(auth.role) ? { ...row, patientPhone: null } : row;
  }

  private async parseTemplateInput(
    auth: AuthTokenPayload,
    body: Body,
    current: QuestionnaireTemplate | null
  ): Promise<QuestionnaireTemplateInput> {
    if (body.active !== undefined && typeof body.active !== "boolean") {
      throw new ApiError(400, "Поле «active» должно быть true или false");
    }
    let doctorId: number | null;
    if (auth.role === "doctor") {
      // A doctor's templates stay bound to that doctor; editing keeps the existing binding.
      doctorId = current ? current.doctorId : ownDoctorId(auth);
    } else {
      doctorId =
        body.doctorId === undefined || body.doctorId === null ? null : parsePositiveId(body.doctorId, "doctorId");
      if (doctorId !== null && !(await this.repository.doctorExists(doctorId))) {
        throw new ApiError(404, "Врач не найден");
      }
    }
    return {
      title: parseRequiredText(body.title, "название", QUESTIONNAIRE_LIMITS.title),
      description: parseOptionalText(body.description, "описание", QUESTIONNAIRE_LIMITS.description),
      doctorId,
      questions: parseQuestions(body.questions),
      active: typeof body.active === "boolean" ? body.active : current?.active ?? true,
    };
  }
}
