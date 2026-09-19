import type { IServicesRepository } from "./interfaces/IServicesRepository";
import type {
  Service,
  ServiceCreateInput,
  ServiceFilters,
  ServiceUpdateInput,
} from "./interfaces/coreTypes";
import { ApiError } from "../middleware/errorHandler";
import { getMockDb, nextId, type ServiceRecord } from "./mockDatabase";
export type { Service, ServiceCreateInput, ServiceFilters, ServiceUpdateInput };

const collectDoctorIds = (serviceId: number): number[] =>
  [...new Set(getMockDb().doctorServices.filter((r) => r.serviceId === serviceId).map((r) => r.doctorId))].sort(
    (a, b) => a - b
  );

const toService = (row: ServiceRecord): Service => ({
  ...row,
  doctorIds: collectDoctorIds(row.id),
});

const assertMockDoctorsExist = (doctorIds: number[]): void => {
  const db = getMockDb();
  for (const id of new Set(doctorIds)) {
    if (!db.doctors.some((d) => d.id === id)) {
      throw new ApiError(400, "One or more doctorIds are invalid or deleted");
    }
  }
};

export class MockServicesRepository implements IServicesRepository {
  async findAll(filters: ServiceFilters = {}): Promise<Service[]> {
    let rows = [...getMockDb().services];
    if (filters.activeOnly === true) {
      rows = rows.filter((row) => row.active);
    }
    if (filters.doctorId !== undefined) {
      const linkedServiceIds = new Set(
        getMockDb()
          .doctorServices.filter((row) => row.doctorId === filters.doctorId)
          .map((row) => row.serviceId)
      );
      rows = rows.filter((row) => linkedServiceIds.has(row.id));
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name)).map(toService);
  }

  async findById(id: number): Promise<Service | null> {
    const found = getMockDb().services.find((item) => item.id === id);
    return found ? toService(found) : null;
  }

  async create(payload: ServiceCreateInput): Promise<Service> {
    const { doctorIds = [], ...rest } = payload;
    assertMockDoctorsExist(doctorIds);
    const created: ServiceRecord = {
      id: nextId(),
      createdAt: new Date().toISOString(),
      ...rest,
    };
    getMockDb().services.push(created);
    const db = getMockDb();
    for (const doctorId of [...new Set(doctorIds)].sort((a, b) => a - b)) {
      db.doctorServices.push({ doctorId, serviceId: created.id });
    }
    return toService(created);
  }

  async update(id: number, payload: ServiceUpdateInput): Promise<Service | null> {
    const db = getMockDb();
    const idx = db.services.findIndex((item) => item.id === id);
    if (idx < 0) return null;

    const { doctorIds, ...scalarPart } = payload;
    if (doctorIds !== undefined) {
      assertMockDoctorsExist(doctorIds);
    }

    if (Object.keys(scalarPart).length > 0) {
      db.services[idx] = { ...db.services[idx], ...scalarPart };
    }

    if (doctorIds !== undefined) {
      db.doctorServices = db.doctorServices.filter((item) => item.serviceId !== id);
      for (const doctorId of [...new Set(doctorIds)].sort((a, b) => a - b)) {
        db.doctorServices.push({ doctorId, serviceId: id });
      }
    }

    return toService(db.services[idx]);
  }

  async delete(id: number): Promise<boolean> {
    const db = getMockDb();
    const before = db.services.length;
    db.services = db.services.filter((item) => item.id !== id);
    db.doctorServices = db.doctorServices.filter((item) => item.serviceId !== id);
    return db.services.length < before;
  }

  async isServiceAssignedToDoctor(serviceId: number, doctorId: number): Promise<boolean> {
    return getMockDb().doctorServices.some(
      (row) => row.serviceId === serviceId && row.doctorId === doctorId
    );
  }

  async assignDoctor(serviceId: number, doctorId: number): Promise<void> {
    const db = getMockDb();
    const exists = db.doctorServices.some(
      (item) => item.serviceId === serviceId && item.doctorId === doctorId
    );
    if (!exists) {
      db.doctorServices.push({ doctorId, serviceId });
    }
  }

  async unassignDoctor(serviceId: number, doctorId: number): Promise<boolean> {
    const db = getMockDb();
    const before = db.doctorServices.length;
    db.doctorServices = db.doctorServices.filter(
      (item) => !(item.serviceId === serviceId && item.doctorId === doctorId)
    );
    return db.doctorServices.length < before;
  }
}
