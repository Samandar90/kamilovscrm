import type { QueryResult } from "pg";
import { dbPool } from "../config/database";
import { ApiError } from "../middleware/errorHandler";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import {
  UZI_TEMPLATES,
  UZI_TEMPLATES_ACCESS,
  type UziTemplate,
  type UziTemplateSummary,
} from "../constants/uziProtocolTemplates";
import type { IDoctorsRepository } from "../repositories/interfaces/IDoctorsRepository";

/**
 * Бланки УЗИ — приватный набор одного врача одной клиники.
 *
 * Двойная проверка, обе обязательны:
 *   1) slug клиники из `clinics` (по clinicId из токена) есть в allowlist;
 *   2) ФИО врача (по doctorId) совпадает с паттерном.
 *
 * Плюс обычный RBAC: врач и медсестра видят только свой контур.
 */
export class UziTemplatesService {
  constructor(private readonly doctorsRepository: IDoctorsRepository) {}

  /** doctorId, который вправе смотреть этот пользователь. Бросает 403 при попытке чужого. */
  private resolveDoctorId(auth: AuthTokenPayload, requestedDoctorId: number): number {
    if (!Number.isInteger(requestedDoctorId) || requestedDoctorId <= 0) {
      throw new ApiError(400, "doctorId is required");
    }
    if (auth.role === "doctor") {
      if (auth.doctorId == null) {
        throw new ApiError(403, "Account is not linked to a doctor profile");
      }
      if (requestedDoctorId !== auth.doctorId) {
        throw new ApiError(403, "Forbidden");
      }
    }
    if (auth.role === "nurse") {
      if (auth.nurseDoctorId == null) {
        throw new ApiError(403, "Медсестра не привязана к врачу");
      }
      if (requestedDoctorId !== auth.nurseDoctorId) {
        throw new ApiError(403, "Forbidden");
      }
    }
    return requestedDoctorId;
  }

  private async isClinicAllowed(clinicId: number): Promise<boolean> {
    if (!Number.isInteger(clinicId) || clinicId <= 0) return false;
    const result: QueryResult<{ slug: string | null }> = await dbPool.query(
      `SELECT slug FROM clinics WHERE id = $1 LIMIT 1`,
      [clinicId]
    );
    const slug = result.rows[0]?.slug?.trim().toLowerCase();
    if (!slug) return false;
    return UZI_TEMPLATES_ACCESS.clinicSlugs.some((allowed) => allowed.toLowerCase() === slug);
  }

  private async isDoctorAllowed(doctorId: number): Promise<boolean> {
    const doctor = await this.doctorsRepository.findById(doctorId);
    const name = doctor?.name?.trim().toLowerCase();
    if (!name) return false;
    return UZI_TEMPLATES_ACCESS.doctorNamePatterns.some((pattern) =>
      name.includes(pattern.toLowerCase())
    );
  }

  /** true — только если и клиника, и врач из allowlist. */
  async isEnabled(auth: AuthTokenPayload, requestedDoctorId: number): Promise<boolean> {
    const doctorId = this.resolveDoctorId(auth, requestedDoctorId);
    if (!(await this.isClinicAllowed(auth.clinicId))) return false;
    return this.isDoctorAllowed(doctorId);
  }

  /** Список бланков без тел. Пустой массив, если доступа нет — не 403, чтобы UI просто не показывал раздел. */
  async list(
    auth: AuthTokenPayload,
    requestedDoctorId: number
  ): Promise<{ enabled: boolean; templates: UziTemplateSummary[] }> {
    const enabled = await this.isEnabled(auth, requestedDoctorId);
    if (!enabled) {
      return { enabled: false, templates: [] };
    }
    const templates = UZI_TEMPLATES.map(({ id, title, category }) => ({ id, title, category }));
    return { enabled: true, templates };
  }

  /** Тело бланка. 403 при отсутствии доступа, 404 если такого id нет. */
  async getById(
    auth: AuthTokenPayload,
    requestedDoctorId: number,
    templateId: string
  ): Promise<UziTemplate> {
    const enabled = await this.isEnabled(auth, requestedDoctorId);
    if (!enabled) {
      throw new ApiError(403, "Протоколы УЗИ недоступны для этой клиники или врача");
    }
    const template = UZI_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      throw new ApiError(404, "Протокол не найден");
    }
    return template;
  }
}
