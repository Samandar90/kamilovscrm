import { requireClinicId } from "../../tenancy/clinicContext";
import type { QueryPool } from "./queryPool";
import type {
  AppointmentContext,
  IQuestionnairesRepository,
  PatientQuestionnaire,
  PatientQuestionnaireCreateInput,
  PatientQuestionnaireSummary,
  QuestionnaireAnswers,
  QuestionnaireFilters,
  QuestionnaireListResult,
  QuestionnaireQuestion,
  QuestionnaireTemplate,
  QuestionnaireTemplateInput,
} from "../interfaces/questionnaireTypes";

type Row = Record<string, unknown>;

const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
const numberOrNull = (value: unknown): number | null => (value == null ? null : Number(value));
const stringOrNull = (value: unknown): string | null => (value == null ? null : String(value));
/** node-postgres and PGlite both parse jsonb; a string can only come from a text cast. */
const json = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
/** ILIKE pattern for a user-supplied substring (backslash is the default escape). */
const containsPattern = (value: string): string => `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

const TEMPLATE_SELECT = `
  SELECT t.id, t.title, t.description, t.doctor_id, d.full_name AS doctor_name, t.questions, t.active,
    t.created_by, u.full_name AS created_by_name, t.created_at, t.updated_at,
    (SELECT count(*) FROM patient_questionnaires q
      WHERE q.template_id = t.id AND q.clinic_id = t.clinic_id AND q.deleted_at IS NULL) AS usage_count
  FROM questionnaire_templates t
  LEFT JOIN doctors d ON d.id = t.doctor_id AND d.clinic_id = t.clinic_id
  LEFT JOIN users u ON u.id = t.created_by
`;

const mapTemplate = (row: Row): QuestionnaireTemplate => ({
  id: Number(row.id),
  title: String(row.title),
  description: stringOrNull(row.description),
  doctorId: numberOrNull(row.doctor_id),
  doctorName: stringOrNull(row.doctor_name),
  questions: json<QuestionnaireQuestion[]>(row.questions),
  active: row.active !== false,
  createdBy: numberOrNull(row.created_by),
  createdByName: stringOrNull(row.created_by_name),
  usageCount: Number(row.usage_count ?? 0),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const QUESTIONNAIRE_FROM = `
  FROM patient_questionnaires q
  INNER JOIN patients p ON p.id = q.patient_id
  LEFT JOIN doctors d ON d.id = q.doctor_id
  LEFT JOIN users cu ON cu.id = q.created_by
  LEFT JOIN users uu ON uu.id = q.updated_by
`;

const SUMMARY_COLUMNS = `
  q.id, q.patient_id, p.full_name AS patient_name, p.phone AS patient_phone, q.template_id, q.title,
  q.appointment_id, q.doctor_id, d.full_name AS doctor_name, q.created_by,
  cu.full_name AS created_by_name, uu.full_name AS updated_by_name,
  jsonb_array_length(q.questions) AS question_count,
  (SELECT count(*) FROM jsonb_object_keys(q.answers)) AS answered_count,
  q.created_at, q.updated_at
`;

const mapSummary = (row: Row): PatientQuestionnaireSummary => ({
  id: Number(row.id),
  patientId: Number(row.patient_id),
  patientName: String(row.patient_name),
  patientPhone: stringOrNull(row.patient_phone),
  templateId: numberOrNull(row.template_id),
  title: String(row.title),
  appointmentId: numberOrNull(row.appointment_id),
  doctorId: numberOrNull(row.doctor_id),
  doctorName: stringOrNull(row.doctor_name),
  createdBy: numberOrNull(row.created_by),
  createdByName: stringOrNull(row.created_by_name),
  updatedByName: stringOrNull(row.updated_by_name),
  questionCount: Number(row.question_count ?? 0),
  answeredCount: Number(row.answered_count ?? 0),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export class PostgresQuestionnairesRepository implements IQuestionnairesRepository {
  /** `timeZone` is the clinic calendar used for date filters (REPORTS_TIMEZONE). */
  constructor(private readonly pool: QueryPool, private readonly timeZone: string) {}

  async listTemplates(options: { includeInactive: boolean }): Promise<QuestionnaireTemplate[]> {
    const { rows } = await this.pool.query(
      `${TEMPLATE_SELECT}
       WHERE t.clinic_id = $1 AND ($2::boolean OR t.active)
       ORDER BY t.active DESC, lower(t.title), t.id`,
      [requireClinicId(), options.includeInactive]
    );
    return rows.map(mapTemplate);
  }

  async findTemplate(id: number): Promise<QuestionnaireTemplate | null> {
    const { rows } = await this.pool.query(`${TEMPLATE_SELECT} WHERE t.id = $1 AND t.clinic_id = $2`, [
      id,
      requireClinicId(),
    ]);
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  async createTemplate(input: QuestionnaireTemplateInput, userId: number): Promise<QuestionnaireTemplate> {
    const { rows } = await this.pool.query(
      `INSERT INTO questionnaire_templates
         (clinic_id, title, description, doctor_id, questions, active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)
       RETURNING id`,
      [
        requireClinicId(),
        input.title,
        input.description,
        input.doctorId,
        JSON.stringify(input.questions),
        input.active,
        userId,
      ]
    );
    return (await this.findTemplate(Number(rows[0].id))) as QuestionnaireTemplate;
  }

  async updateTemplate(
    id: number,
    input: QuestionnaireTemplateInput,
    userId: number
  ): Promise<QuestionnaireTemplate | null> {
    const { rows } = await this.pool.query(
      `UPDATE questionnaire_templates
       SET title = $3, description = $4, doctor_id = $5, questions = $6::jsonb, active = $7,
         updated_by = $8, updated_at = now()
       WHERE id = $1 AND clinic_id = $2
       RETURNING id`,
      [
        id,
        requireClinicId(),
        input.title,
        input.description,
        input.doctorId,
        JSON.stringify(input.questions),
        input.active,
        userId,
      ]
    );
    return rows[0] ? this.findTemplate(id) : null;
  }

  async list(filters: QuestionnaireFilters): Promise<QuestionnaireListResult> {
    const values: unknown[] = [requireClinicId()];
    const where = ["q.clinic_id = $1", "q.deleted_at IS NULL"];
    const add = (clause: (param: string) => string, value: unknown) => {
      values.push(value);
      where.push(clause(`$${values.length}`));
    };
    if (filters.patientId !== undefined) add((p) => `q.patient_id = ${p}`, filters.patientId);
    if (filters.templateId !== undefined) add((p) => `q.template_id = ${p}`, filters.templateId);
    if (filters.doctorId !== undefined) add((p) => `q.doctor_id = ${p}`, filters.doctorId);
    if (filters.search) {
      add(
        (p) => `(p.full_name ILIKE ${p} OR p.phone ILIKE ${p} OR q.title ILIKE ${p})`,
        containsPattern(filters.search)
      );
    }
    if (filters.dateFrom || filters.dateTo) {
      values.push(this.timeZone);
      const zone = `$${values.length}`;
      if (filters.dateFrom) add((p) => `(q.created_at AT TIME ZONE ${zone})::date >= ${p}::date`, filters.dateFrom);
      if (filters.dateTo) add((p) => `(q.created_at AT TIME ZONE ${zone})::date <= ${p}::date`, filters.dateTo);
    }
    const whereSql = where.join(" AND ");
    const pageValues = [...values, filters.limit, filters.offset];
    const [page, count] = await Promise.all([
      this.pool.query(
        `SELECT ${SUMMARY_COLUMNS} ${QUESTIONNAIRE_FROM}
         WHERE ${whereSql}
         ORDER BY q.created_at DESC, q.id DESC
         LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues
      ),
      this.pool.query(`SELECT count(*) AS total ${QUESTIONNAIRE_FROM} WHERE ${whereSql}`, values),
    ]);
    return { items: page.rows.map(mapSummary), total: Number(count.rows[0]?.total ?? 0) };
  }

  async findById(id: number): Promise<PatientQuestionnaire | null> {
    const { rows } = await this.pool.query(
      `SELECT ${SUMMARY_COLUMNS}, q.questions, q.answers ${QUESTIONNAIRE_FROM}
       WHERE q.id = $1 AND q.clinic_id = $2 AND q.deleted_at IS NULL`,
      [id, requireClinicId()]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...mapSummary(row),
      questions: json<QuestionnaireQuestion[]>(row.questions),
      answers: json<QuestionnaireAnswers>(row.answers),
    };
  }

  async create(input: PatientQuestionnaireCreateInput, userId: number): Promise<PatientQuestionnaire> {
    const { rows } = await this.pool.query(
      `INSERT INTO patient_questionnaires
         (clinic_id, patient_id, template_id, appointment_id, doctor_id, title, questions, answers, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $9)
       RETURNING id`,
      [
        requireClinicId(),
        input.patientId,
        input.templateId,
        input.appointmentId,
        input.doctorId,
        input.title,
        JSON.stringify(input.questions),
        JSON.stringify(input.answers),
        userId,
      ]
    );
    return (await this.findById(Number(rows[0].id))) as PatientQuestionnaire;
  }

  async updateAnswers(
    id: number,
    answers: QuestionnaireAnswers,
    userId: number
  ): Promise<PatientQuestionnaire | null> {
    const { rows } = await this.pool.query(
      `UPDATE patient_questionnaires
       SET answers = $3::jsonb, updated_by = $4, updated_at = now()
       WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, requireClinicId(), JSON.stringify(answers), userId]
    );
    return rows[0] ? this.findById(id) : null;
  }

  async softDelete(id: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `UPDATE patient_questionnaires SET deleted_at = now()
       WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, requireClinicId()]
    );
    return rows.length > 0;
  }

  async patientExists(id: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM patients WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL`,
      [id, requireClinicId()]
    );
    return rows.length > 0;
  }

  async doctorExists(id: number): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM doctors WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL`,
      [id, requireClinicId()]
    );
    return rows.length > 0;
  }

  async findAppointmentContext(appointmentId: number): Promise<AppointmentContext | null> {
    const { rows } = await this.pool.query(
      `SELECT patient_id, doctor_id FROM appointments WHERE id = $1 AND clinic_id = $2 AND deleted_at IS NULL`,
      [appointmentId, requireClinicId()]
    );
    return rows[0] ? { patientId: Number(rows[0].patient_id), doctorId: Number(rows[0].doctor_id) } : null;
  }
}
