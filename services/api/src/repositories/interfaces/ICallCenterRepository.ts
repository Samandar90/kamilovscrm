import type {
  CallMarkInput,
  CallQueueItem,
  CallReminderLog,
  CallReminderRule,
} from "./callCenterTypes";

export interface ICallCenterRepository {
  listRules(): Promise<CallReminderRule[]>;
  /** Добавляет точку напоминания; при дубле days_before возвращает существующую. */
  addRule(daysBefore: number): Promise<CallReminderRule>;
  removeRule(id: number): Promise<boolean>;
  /**
   * Очередь звонков на дату callDate: по каждому правилу — записи со статусом
   * scheduled/confirmed, чья настенная дата = callDate + days_before.
   */
  queueForDate(callDate: string): Promise<CallQueueItem[]>;
  /** Отметить исход звонка (upsert по appointment_id + days_before). */
  mark(input: CallMarkInput): Promise<CallReminderLog>;
}
