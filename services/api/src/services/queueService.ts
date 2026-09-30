import { ApiError } from "../middleware/errorHandler";
import type { IQueueRepository, QueueEntry, QueueTicket, QueueToday } from "../repositories/interfaces/queueTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import { parseQueueDoctorFilter } from "../validators/queueValidators";
import { getEffectiveDoctorId, isDoctorScopedRole } from "./clinicalDataScope";
import { loadQueueDay, toQueueEntry } from "./queue/queueDay";
import { clinicToday, formatQueueCode } from "./queue/queueRules";

const FOREIGN_QUEUE = "Можно работать только со своей очередью";
const NOT_FOUND = "Запись не найдена";

export class QueueService {
  constructor(
    private readonly repo: IQueueRepository,
    private readonly timeZone: string = "Asia/Tashkent",
    private readonly now: () => Date = () => new Date()
  ) {}

  async today(auth: AuthTokenPayload, query: unknown): Promise<QueueToday> {
    const requested = parseQueueDoctorFilter(query);
    const own = this.ownDoctorId(auth);
    if (own != null && requested != null && requested !== own) {
      throw new ApiError(403, FOREIGN_QUEUE);
    }
    const doctorId = own ?? requested;
    const now = this.now();
    const date = clinicToday(this.timeZone, now);
    // Выбранный врач (для врача/медсестры — свой) показывается карточкой даже с пустой очередью.
    const filter = doctorId == null ? null : [doctorId];
    const { doctors } = await loadQueueDay(this.repo, auth.clinicId, date, filter, filter ?? []);
    return { date, timeZone: this.timeZone, serverTime: now.toISOString(), doctors };
  }

  async issue(auth: AuthTokenPayload, appointmentId: number): Promise<{ entry: QueueEntry }> {
    const target = await this.repo.findTarget(auth.clinicId, appointmentId);
    if (!target) {
      throw new ApiError(404, NOT_FOUND);
    }
    this.assertOwnQueue(auth, target.doctorId);
    if (target.status !== "arrived") {
      throw new ApiError(409, "Номер выдаётся только пришедшему пациенту");
    }
    const day = this.currentDay();
    if (target.startAt.slice(0, 10) !== day) {
      throw new ApiError(409, "Запись не на сегодня");
    }
    await this.repo.issue(auth.clinicId, appointmentId, day);
    return { entry: await this.entry(auth.clinicId, appointmentId) };
  }

  async call(auth: AuthTokenPayload, appointmentId: number): Promise<{ entry: QueueEntry }> {
    const target = await this.repo.findTarget(auth.clinicId, appointmentId);
    if (!target) {
      throw new ApiError(404, NOT_FOUND);
    }
    this.assertOwnQueue(auth, target.doctorId);
    if (!(await this.repo.call(auth.clinicId, appointmentId, this.currentDay()))) {
      throw new ApiError(409, "Пациент не ожидает в очереди");
    }
    return { entry: await this.entry(auth.clinicId, appointmentId) };
  }

  async callNext(auth: AuthTokenPayload, doctorId: number): Promise<{ entry: QueueEntry | null }> {
    this.assertOwnQueue(auth, doctorId);
    const appointmentId = await this.repo.callNext(auth.clinicId, doctorId, this.currentDay());
    return { entry: appointmentId == null ? null : await this.entry(auth.clinicId, appointmentId) };
  }

  async ticket(auth: AuthTokenPayload, appointmentId: number): Promise<QueueTicket> {
    const row = await this.repo.getDayRow(auth.clinicId, appointmentId);
    if (!row) {
      throw new ApiError(404, NOT_FOUND);
    }
    this.assertOwnQueue(auth, row.doctorId);
    if (row.queueNumber == null || row.queueDate == null) {
      throw new ApiError(404, "У записи нет номера очереди");
    }
    const [doctors, clinicName, aheadCount] = await Promise.all([
      this.repo.listDoctors(auth.clinicId, [row.doctorId]),
      this.repo.clinicName(auth.clinicId),
      this.repo.countAhead(auth.clinicId, row.doctorId, row.queueDate, row.queueNumber),
    ]);
    const doctor = doctors[0];
    return {
      appointmentId: row.appointmentId,
      clinicName,
      code: formatQueueCode(row.queuePrefix, row.queueNumber),
      number: row.queueNumber,
      doctorName: doctor?.name ?? "",
      specialty: doctor?.specialty ?? "",
      room: doctor?.room ?? null,
      issuedAt: row.issuedAt ?? this.now().toISOString(),
      aheadCount,
      timeZone: this.timeZone,
    };
  }

  /** Врач/медсестра — id «своего» врача; остальные роли видят все очереди клиники (null). */
  private ownDoctorId(auth: AuthTokenPayload): number | null {
    // getEffectiveDoctorId бросает 500 для не-врачебных ролей — вызываем только после isDoctorScopedRole.
    return isDoctorScopedRole(auth.role) ? getEffectiveDoctorId(auth) : null;
  }

  private assertOwnQueue(auth: AuthTokenPayload, doctorId: number): void {
    const own = this.ownDoctorId(auth);
    if (own != null && own !== doctorId) {
      throw new ApiError(403, FOREIGN_QUEUE);
    }
  }

  private currentDay(): string {
    return clinicToday(this.timeZone, this.now());
  }

  private async entry(clinicId: number, appointmentId: number): Promise<QueueEntry> {
    const row = await this.repo.getDayRow(clinicId, appointmentId);
    const entry = row ? toQueueEntry(row) : null;
    if (!entry) {
      throw new ApiError(404, NOT_FOUND);
    }
    return entry;
  }
}
