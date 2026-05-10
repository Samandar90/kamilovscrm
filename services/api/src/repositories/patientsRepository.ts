import type { IPatientsRepository } from "./interfaces/IPatientsRepository";
import type {
  Patient,
  PatientCreateInput,
  PatientFilters,
  PatientUpdateInput,
} from "./interfaces/coreTypes";
import { getMockDb, nextId, type PatientRecord } from "./mockDatabase";

export type { Patient, PatientCreateInput, PatientFilters, PatientUpdateInput };

const toPatient = (row: PatientRecord): Patient => ({
  id: row.id,
  fullName: row.fullName,
  phone: row.phone,
  gender: row.gender,
  birthDate: row.birthDate,
  source: row.source ?? null,
  notes: row.notes ?? null,
  createdAt: row.createdAt,
  createdByDoctorId: row.createdByDoctorId ?? null,
  createdByUserId: row.createdByUserId ?? null,
});

const isActive = (row: PatientRecord): boolean => row.deletedAt === null;

const PATIENT_SEARCH_LIMIT = 20;

const matchesPatientSearch = (row: PatientRecord, term: string): boolean => {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const name = row.fullName.toLowerCase();
  const phone = (row.phone ?? "").toLowerCase();
  return name.includes(q) || phone.includes(q);
};

const matchesDoctorRelationshipScope = (
  row: PatientRecord,
  filters: PatientFilters
): boolean => {
  const d = filters.doctorRelationshipScope;
  if (d === undefined) {
    return true;
  }
  if (row.createdByDoctorId === d) {
    return true;
  }
  if (filters.alsoCreatedByUserId != null && row.createdByUserId === filters.alsoCreatedByUserId) {
    return true;
  }
  return getMockDb().appointments.some(
    (a) => a.patientId === row.id && a.doctorId === d
  );
};

export class MockPatientsRepository implements IPatientsRepository {
  async findAll(filters: PatientFilters = {}): Promise<Patient[]> {
    let rows = [...getMockDb().patients];
    const includeDeleted = filters.includeDeleted === true;
    const searchTerm = typeof filters.search === "string" ? filters.search.trim() : "";
    const hasSearch = searchTerm.length > 0;

    if (!includeDeleted || hasSearch) {
      rows = rows.filter(isActive);
    }
    if (filters.ids !== undefined) {
      const allowed = new Set(filters.ids);
      rows = rows.filter((row) => allowed.has(row.id));
    }
    rows = rows.filter((row) => matchesDoctorRelationshipScope(row, filters));
    if (hasSearch) {
      rows = rows.filter((row) => matchesPatientSearch(row, searchTerm));
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (hasSearch) {
      rows = rows.slice(0, PATIENT_SEARCH_LIMIT);
    }
    return rows.map(toPatient);
  }

  async findById(id: number): Promise<Patient | null> {
    const found = getMockDb().patients.find((item) => item.id === id);
    return found ? toPatient(found) : null;
  }

  async create(payload: PatientCreateInput): Promise<Patient> {
    const created: PatientRecord = {
      id: nextId(),
      fullName: payload.fullName,
      phone: payload.phone,
      gender: payload.gender,
      birthDate: payload.birthDate,
      source: payload.source ?? null,
      notes: payload.notes ?? null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      createdByDoctorId: payload.createdByDoctorId ?? null,
      createdByUserId: payload.createdByUserId ?? null,
    };
    getMockDb().patients.push(created);
    return toPatient(created);
  }

  async update(id: number, payload: PatientUpdateInput): Promise<Patient | null> {
    const db = getMockDb();
    const idx = db.patients.findIndex((item) => item.id === id);
    if (idx < 0) return null;
    if (!isActive(db.patients[idx])) return null;
    db.patients[idx] = { ...db.patients[idx], ...payload };
    return toPatient(db.patients[idx]);
  }

  async delete(id: number): Promise<boolean> {
    const db = getMockDb();
    const idx = db.patients.findIndex((item) => item.id === id);
    if (idx < 0) return false;
    if (!isActive(db.patients[idx])) return false;
    db.patients[idx] = {
      ...db.patients[idx],
      deletedAt: new Date().toISOString(),
    };
    return true;
  }
}
