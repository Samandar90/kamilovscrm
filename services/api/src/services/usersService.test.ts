import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../config/env", () => ({ env: { isProduction: false, jwtSecret: "isolated-users-service-tests-only" } }));
vi.mock("../utils/password", () => ({ hashPassword: async (plain: string) => `hash:${plain}` }));
import { UsersService } from "./usersService";
import type { AuthTokenPayload, CreateUserInput, User } from "../repositories/interfaces/userTypes";

const usersRepository = {
  findAll: vi.fn(),
  findById: vi.fn(),
  findByUsername: vi.fn(),
  findByUsernameIncludingInactive: vi.fn(),
  findActiveDoctorUserIdByDoctorProfile: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  toggleActive: vi.fn(),
  updatePassword: vi.fn(),
  updateSecurityState: vi.fn(),
};
const doctorsRepository = { findById: vi.fn() };
const nursesRepository = { findDoctorIdByUserId: vi.fn(), upsert: vi.fn(), deleteByUserId: vi.fn() };
const service = new UsersService(usersRepository, doctorsRepository as never, nursesRepository);

/** Superadmin of clinic 2: every repository lookup below is scoped to that clinic. */
const admin: AuthTokenPayload = { userId: 9, clinicId: 2, username: "a", role: "superadmin" };
const stored = (patch: Partial<User> = {}): User => ({
  id: 30, clinicId: 2, username: "target", password: "hash:secret1", fullName: "Таргетолог", role: "marketer", isActive: true,
  createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", deletedAt: null, doctorId: null, ...patch,
});
const input: CreateUserInput = { username: "target", password: "secret1", fullName: "Таргетолог", role: "marketer" };

beforeEach(() => {
  vi.resetAllMocks();
  usersRepository.findByUsernameIncludingInactive.mockResolvedValue(null);
  usersRepository.create.mockImplementation(async (data: CreateUserInput) => stored({ clinicId: data.clinicId, role: data.role }));
});

describe("createUser", () => {
  it("puts the new user into the creator's clinic when the body names none", async () => {
    const created = await service.createUser(admin, input);

    expect(usersRepository.create).toHaveBeenCalledTimes(1);
    expect(usersRepository.create).toHaveBeenCalledWith({
      username: "target", password: "hash:secret1", fullName: "Таргетолог", role: "marketer", isActive: true, clinicId: 2, doctorId: null,
    });
    expect(created).toMatchObject({ clinicId: 2, role: "marketer" });
    expect(created).not.toHaveProperty("password");
  });

  it("rejects a body clinic other than the creator's", async () => {
    await expect(service.createUser(admin, { ...input, clinicId: 1 })).rejects.toMatchObject({ status: 403 });
    expect(usersRepository.create).not.toHaveBeenCalled();
  });

  it("accepts a body clinic equal to the creator's", async () => {
    await service.createUser(admin, { ...input, clinicId: 2 });
    expect(usersRepository.create).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 2, role: "marketer", doctorId: null }));
  });
});
