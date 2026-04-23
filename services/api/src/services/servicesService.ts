import {
  type IServicesRepository,
} from "../repositories/interfaces/IServicesRepository";
import type {
  Service,
  ServiceCreateInput,
  ServiceFilters,
  ServiceUpdateInput,
} from "../repositories/interfaces/coreTypes";
import type { AuthTokenPayload } from "../repositories/interfaces/userTypes";
import { ApiError } from "../middleware/errorHandler";
import { parseNumericInput, parseRequiredMoney } from "../utils/numbers";

export class ServicesService {
  constructor(private readonly servicesRepository: IServicesRepository) {}

  async list(auth: AuthTokenPayload, filters: ServiceFilters = {}): Promise<Service[]> {
    const effective: ServiceFilters = { ...filters };
    if (auth.role === "doctor") {
      if (auth.doctorId == null) {
        throw new ApiError(403, "Account is not linked to a doctor profile");
      }
      effective.doctorId = auth.doctorId;
      effective.activeOnly = true;
    } else if (auth.role === "nurse") {
      if (auth.nurseDoctorId == null) {
        throw new ApiError(403, "Медсестра не привязана к врачу");
      }
      effective.doctorId = auth.nurseDoctorId;
      effective.activeOnly = true;
    } else if (effective.doctorId !== undefined) {
      effective.activeOnly = true;
    }
    return this.servicesRepository.findAll(effective);
  }

  async getById(auth: AuthTokenPayload, id: number): Promise<Service | null> {
    const row = await this.servicesRepository.findById(id);
    if (!row) {
      return null;
    }
    if (auth.role === "doctor") {
      if (auth.doctorId == null) {
        throw new ApiError(403, "Account is not linked to a doctor profile");
      }
      const assigned = await this.servicesRepository.isServiceAssignedToDoctor(id, auth.doctorId);
      return assigned ? row : null;
    }
    if (auth.role === "nurse") {
      if (auth.nurseDoctorId == null) {
        throw new ApiError(403, "Медсестра не привязана к врачу");
      }
      const assigned = await this.servicesRepository.isServiceAssignedToDoctor(
        id,
        auth.nurseDoctorId
      );
      return assigned ? row : null;
    }
    return row;
  }

  async create(_auth: AuthTokenPayload, payload: ServiceCreateInput): Promise<Service> {
    const price = parseRequiredMoney(payload.price as unknown, "price");
    if (price < 0) {
      throw new ApiError(400, "Field 'price' must be a number greater than or equal to 0");
    }
    const d = parseNumericInput(payload.duration);
    if (d === null || d <= 0) {
      throw new ApiError(400, "Поле «длительность» должно быть положительным числом");
    }
    const duration = Math.round(d);
    return this.servicesRepository.create({
      ...payload,
      price,
      duration,
    });
  }

  async update(
    _auth: AuthTokenPayload,
    id: number,
    payload: ServiceUpdateInput
  ): Promise<Service | null> {
    const next: ServiceUpdateInput = { ...payload };
    if (payload.price !== undefined) {
      const price = parseRequiredMoney(payload.price as unknown, "price");
      if (price < 0) {
        throw new ApiError(400, "Field 'price' must be a number greater than or equal to 0");
      }
      next.price = price;
    }
    if (payload.duration !== undefined) {
      const d = parseNumericInput(payload.duration);
      if (d === null || d <= 0) {
        throw new ApiError(400, "Поле «длительность» должно быть положительным числом");
      }
      next.duration = Math.round(d);
    }
    return this.servicesRepository.update(id, next);
  }

  async delete(_auth: AuthTokenPayload, id: number): Promise<boolean> {
    return this.servicesRepository.delete(id);
  }

  async isServiceAssignedToDoctor(
    _auth: AuthTokenPayload,
    serviceId: number,
    doctorId: number
  ): Promise<boolean> {
    return this.servicesRepository.isServiceAssignedToDoctor(serviceId, doctorId);
  }
}

