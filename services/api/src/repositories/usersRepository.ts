import type { IUsersRepository } from "./interfaces/IUsersRepository";
import type {
  CreateUserInput,
  UpdateUserInput,
  User,
  UsersFilters,
} from "./interfaces/userTypes";
import { getMockDb, nextId, type UserRecord } from "./mockDatabase";

export type { CreateUserInput, UpdateUserInput, User, UsersFilters };

const toUser = (record: UserRecord): User => ({
  id: record.id,
  clinicId: record.clinicId,
  username: record.username,
  password: record.password,
  fullName: record.fullName,
  role: record.role,
  isActive: record.isActive,
  lastLoginAt: record.lastLoginAt ?? null,
  failedLoginAttempts: record.failedLoginAttempts ?? 0,
  lockedUntil: record.lockedUntil ?? null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  deletedAt: record.deletedAt,
  ...(record.doctorId !== undefined && record.doctorId !== null
    ? { doctorId: record.doctorId }
    : {}),
});

export class MockUsersRepository implements IUsersRepository {
  async findAll(filters: UsersFilters = {}): Promise<User[]> {
    const search = filters.search?.trim().toLowerCase();
    return getMockDb()
      .users.filter((user) => {
        if (user.deletedAt) return false;
        if (filters.role !== undefined && user.role !== filters.role) return false;
        if (filters.isActive !== undefined && user.isActive !== filters.isActive) return false;
        if (search) {
          if (
            !user.username.toLowerCase().includes(search) &&
            !user.fullName.toLowerCase().includes(search)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toUser);
  }

  async findById(id: number): Promise<User | null> {
    const found = getMockDb().users.find((user) => user.id === id && !user.deletedAt);
    return found ? toUser(found) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const found = getMockDb().users.find(
      (user) =>
        user.username.toLowerCase() === username.toLowerCase() && user.isActive
        && !user.deletedAt
    );
    return found ? toUser(found) : null;
  }

  async findByUsernameIncludingInactive(username: string): Promise<User | null> {
    const found = getMockDb().users.find(
      (user) => user.username.toLowerCase() === username.toLowerCase()
    );
    return found ? toUser(found) : null;
  }

  async findActiveDoctorUserIdByDoctorProfile(
    doctorId: number,
    excludeUserId?: number
  ): Promise<number | null> {
    const found = getMockDb().users.find(
      (user) =>
        !user.deletedAt &&
        user.role === "doctor" &&
        user.doctorId === doctorId &&
        (excludeUserId === undefined || user.id !== excludeUserId)
    );
    return found ? found.id : null;
  }

  async create(data: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const created: UserRecord = {
      id: nextId(),
      clinicId: 1,
      username: data.username,
      password: data.password,
      fullName: data.fullName,
      role: data.role,
      isActive: data.isActive ?? true,
      ...(data.role === "doctor" && data.doctorId != null ? { doctorId: data.doctorId } : {}),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    getMockDb().users.push(created);
    return toUser(created);
  }

  async update(id: number, data: UpdateUserInput): Promise<User | null> {
    const db = getMockDb();
    const idx = db.users.findIndex((user) => user.id === id);
    if (idx < 0) return null;
    const prev = db.users[idx];
    const merged: UserRecord = {
      ...prev,
      updatedAt: new Date().toISOString(),
    };
    if (data.fullName !== undefined) merged.fullName = data.fullName;
    if (data.role !== undefined) merged.role = data.role;
    if (data.isActive !== undefined) merged.isActive = data.isActive;
    if (data.doctorId !== undefined) {
      if (data.doctorId === null) {
        delete merged.doctorId;
      } else {
        merged.doctorId = data.doctorId;
      }
    }
    db.users[idx] = merged;
    return toUser(db.users[idx]);
  }

  async delete(id: number): Promise<boolean> {
    const db = getMockDb();
    const idx = db.users.findIndex((user) => user.id === id && !user.deletedAt);
    if (idx < 0) return false;
    db.users[idx] = {
      ...db.users[idx],
      deletedAt: new Date().toISOString(),
      isActive: false,
      updatedAt: new Date().toISOString(),
    };
    return true;
  }

  async toggleActive(id: number): Promise<User | null> {
    const db = getMockDb();
    const idx = db.users.findIndex((user) => user.id === id && !user.deletedAt);
    if (idx < 0) return null;
    db.users[idx] = {
      ...db.users[idx],
      isActive: !db.users[idx].isActive,
      updatedAt: new Date().toISOString(),
    };
    return toUser(db.users[idx]);
  }

  async updatePassword(id: number, passwordHash: string): Promise<User | null> {
    const db = getMockDb();
    const idx = db.users.findIndex((user) => user.id === id && !user.deletedAt);
    if (idx < 0) return null;
    db.users[idx] = {
      ...db.users[idx],
      password: passwordHash,
      updatedAt: new Date().toISOString(),
    };
    return toUser(db.users[idx]);
  }

  async updateSecurityState(
    id: number,
    patch: Partial<{
      lastLoginAt: string | null;
      failedLoginAttempts: number;
      lockedUntil: string | null;
    }>
  ): Promise<User | null> {
    const db = getMockDb();
    const idx = db.users.findIndex((user) => user.id === id && !user.deletedAt);
    if (idx < 0) return null;
    db.users[idx] = {
      ...db.users[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return toUser(db.users[idx]);
  }

}
