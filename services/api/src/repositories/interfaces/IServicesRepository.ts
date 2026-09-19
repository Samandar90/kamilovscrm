import type {
  Service,
  ServiceCreateInput,
  ServiceFilters,
  ServiceUpdateInput,
} from "./coreTypes";

export interface IServicesRepository {
  findAll(filters?: ServiceFilters): Promise<Service[]>;
  findById(id: number): Promise<Service | null>;
  create(data: ServiceCreateInput): Promise<Service>;
  update(id: number, data: ServiceUpdateInput): Promise<Service | null>;
  delete(id: number): Promise<boolean>;
  isServiceAssignedToDoctor(serviceId: number, doctorId: number): Promise<boolean>;
  /** Links an existing service of the clinic to a doctor; idempotent. */
  assignDoctor(serviceId: number, doctorId: number): Promise<void>;
  /** Unlinks a service from a doctor. Returns false when the link did not exist. */
  unassignDoctor(serviceId: number, doctorId: number): Promise<boolean>;
}
