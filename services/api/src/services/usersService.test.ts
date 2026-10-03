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

describe("a user outside the superadmin's clinic", () => {
  // findById is scoped to the request's clinic: a user of another clinic is simply not found.
  beforeEach(() => {
    usersRepository.findById.mockResolvedValue(null);
  });

  it("is not updated", async () => {
    await expect(service.updateUser(admin, 30, { isActive: true })).rejects.toMatchObject({ status: 404 });
    expect(usersRepository.update).not.toHaveBeenCalled();
  });

  it("is not deleted", async () => {
    await expect(service.deleteUser(admin, 30)).rejects.toMatchObject({ status: 404 });
    expect(usersRepository.delete).not.toHaveBeenCalled();
    expect(nursesRepository.deleteByUserId).not.toHaveBeenCalled();
  });

  it("is not switched on or off", async () => {
    await expect(service.toggleUserActive(admin, 30)).rejects.toMatchObject({ status: 404 });
    expect(usersRepository.toggleActive).not.toHaveBeenCalled();
  });

  it("does not get a new password", async () => {
    await expect(service.changeUserPassword(admin, 30, "secret2")).rejects.toMatchObject({ status: 404 });
    expect(usersRepository.updatePassword).not.toHaveBeenCalled();
  });
});

describe("a user of the superadmin's own clinic", () => {
  beforeEach(() => {
    usersRepository.findById.mockResolvedValue(stored());
  });

  it("is updated, deleted, toggled and given a new password as before", async () => {
    usersRepository.update.mockResolvedValue(stored({ fullName: "Новое имя" }));
    expect(await service.updateUser(admin, 30, { fullName: "Новое имя" })).toMatchObject({ id: 30, fullName: "Новое имя" });
    expect(usersRepository.update).toHaveBeenCalledWith(30, { fullName: "Новое имя" });

    usersRepository.toggleActive.mockResolvedValue(stored({ isActive: false }));
    expect(await service.toggleUserActive(admin, 30)).toMatchObject({ id: 30, isActive: false });
    expect(usersRepository.toggleActive).toHaveBeenCalledWith(30);

    usersRepository.updatePassword.mockResolvedValue(stored());
    expect(await service.changeUserPassword(admin, 30, "secret2")).toMatchObject({ id: 30 });
    expect(usersRepository.updatePassword).toHaveBeenCalledWith(30, "hash:secret2");

    usersRepository.delete.mockResolvedValue(true);
    expect(await service.deleteUser(admin, 30)).toBe(true);
    expect(nursesRepository.deleteByUserId).toHaveBeenCalledWith(30);
    expect(usersRepository.delete).toHaveBeenCalledWith(30);
  });
});
