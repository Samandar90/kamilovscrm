import { ApiError } from "../middleware/errorHandler";
import type { IDoctorsRepository } from "../repositories/interfaces/IDoctorsRepository";
import type { INursesRepository } from "../repositories/interfaces/INursesRepository";
import type { IUsersRepository } from "../repositories/interfaces/IUsersRepository";
import {
  USER_MANAGEMENT_ROLES,
  type AuthTokenPayload,
  type CreateUserInput,
  type PublicUser,
  type UpdateUserInput,
  type User,
  type UsersFilters,
} from "../repositories/interfaces/userTypes";
import { hashPassword } from "../utils/password";
import { toPublicUser } from "../utils/userSanitizer";

const isRoleValid = (role: string): role is (typeof USER_MANAGEMENT_ROLES)[number] => {
  return USER_MANAGEMENT_ROLES.includes(role as (typeof USER_MANAGEMENT_ROLES)[number]);
};

export class UsersService {
  constructor(
    private readonly usersRepository: IUsersRepository,
    private readonly doctorsRepository: IDoctorsRepository,
    private readonly nursesRepository: INursesRepository
  ) {}

  private async enrichPublicUser(user: User): Promise<PublicUser> {
    const base = toPublicUser(user);
    if (user.role !== "nurse") {
      return base;
    }
    const nid = await this.nursesRepository.findDoctorIdByUserId(user.id);
    return { ...base, nurseDoctorId: nid };
  }

  /**
   * Цель действия superadmin — только пользователь его клиники: findById ищет в клинике запроса.
   * Пользователь другой клиники для него не существует (404), изменяющий запрос не выполняется.
   */
  private async requireUserOfOwnClinic(id: number): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    return user;
  }

  async getAllUsers(_auth: AuthTokenPayload, filters: UsersFilters = {}) {
    try {
      const users = await this.usersRepository.findAll(filters);
      const out: PublicUser[] = [];
      for (const u of users) {
        out.push(await this.enrichPublicUser(u));
      }
      return out;
    } catch (_error) {
      throw new ApiError(500, "Ошибка загрузки пользователей");
    }
  }

  async getUserById(_auth: AuthTokenPayload, id: number) {
    const user = await this.usersRepository.findById(id);
    return user ? await this.enrichPublicUser(user) : null;
  }

  async createUser(_auth: AuthTokenPayload, data: CreateUserInput) {
    if (_auth.role !== "superadmin") {
      throw new ApiError(403, "Only superadmin can create users");
    }
    // Клиника нового пользователя — всегда клиника создающего (из токена), а не из тела запроса.
    if (data.clinicId !== undefined && data.clinicId !== _auth.clinicId) {
      throw new ApiError(403, "Нельзя создать пользователя в другой клинике");
    }
    if (!isRoleValid(data.role)) {
      throw new ApiError(400, "Invalid user role");
    }
    if (typeof data.password !== "string" || data.password.length < 6) {
      throw new ApiError(400, "Password must be at least 6 characters");
    }

    if (data.role === "doctor") {
      if (data.doctorId == null || !Number.isInteger(data.doctorId) || data.doctorId <= 0) {
        throw new ApiError(400, "Для роли врач обязательно поле doctor_id");
      }
      const doctor = await this.doctorsRepository.findById(data.doctorId);
      if (!doctor) {
        throw new ApiError(400, "Врач с указанным doctor_id не найден");
      }
      const taken = await this.usersRepository.findActiveDoctorUserIdByDoctorProfile(
        data.doctorId
      );
      if (taken !== null) {
        throw new ApiError(
          409,
          "На выбранного врача уже заведён пользователь с ролью врач"
        );
      }
    }

    if (data.role === "nurse") {
      if (data.doctorId == null || !Number.isInteger(data.doctorId) || data.doctorId <= 0) {
        throw new ApiError(400, "Для роли медсестра обязательно поле doctor_id");
      }
      const doctor = await this.doctorsRepository.findById(data.doctorId);
      if (!doctor) {
        throw new ApiError(400, "Врач с указанным doctor_id не найден");
      }
    }

    const existing = await this.usersRepository.findByUsernameIncludingInactive(
      data.username
    );
    if (existing) {
      throw new ApiError(409, "Username already exists");
    }

    const created = await this.usersRepository.create({
      username: data.username,
      password: await hashPassword(data.password),
      fullName: data.fullName,
      role: data.role,
      isActive: data.isActive ?? true,
      clinicId: _auth.clinicId,
      doctorId: data.role === "doctor" ? data.doctorId! : null,
    });

    if (data.role === "nurse") {
      await this.nursesRepository.upsert(created.id, data.doctorId!);
      return { ...toPublicUser(created), nurseDoctorId: data.doctorId! };
    }

    return toPublicUser(created);
  }

  async updateUser(_auth: AuthTokenPayload, id: number, data: UpdateUserInput) {
    if (_auth.role !== "superadmin") {
      throw new ApiError(403, "Only superadmin can update users");
    }
    const current = await this.requireUserOfOwnClinic(id);

    if (data.role !== undefined && !isRoleValid(data.role)) {
      throw new ApiError(400, "Invalid user role");
    }

    if (data.fullName !== undefined && data.fullName.trim() === "") {
      throw new ApiError(400, "Field 'fullName' must be non-empty string");
    }

    const nextRole = data.role ?? current.role;

    let nurseDoctorToBind: number | null = null;
    if (nextRole === "nurse") {
      const raw =
        data.doctorId !== undefined
          ? data.doctorId
          : await this.nursesRepository.findDoctorIdByUserId(id);
      if (raw == null || !Number.isInteger(raw) || raw <= 0) {
        throw new ApiError(400, "Для роли медсестра укажите doctor_id");
      }
      const d = await this.doctorsRepository.findById(raw);
      if (!d) {
        throw new ApiError(400, "Врач с указанным doctor_id не найден");
      }
      nurseDoctorToBind = raw;
    }

    const patch: UpdateUserInput = { ...data };

    if (nextRole === "doctor") {
      const rawDoctorId =
        data.doctorId !== undefined ? data.doctorId : current.doctorId ?? null;
      if (rawDoctorId == null || !Number.isInteger(rawDoctorId) || rawDoctorId <= 0) {
        throw new ApiError(400, "Для роли врач укажите doctor_id (профиль врача)");
      }
      const doctor = await this.doctorsRepository.findById(rawDoctorId);
      if (!doctor) {
        throw new ApiError(400, "Врач с указанным doctor_id не найден");
      }
      const taken = await this.usersRepository.findActiveDoctorUserIdByDoctorProfile(
        rawDoctorId,
        id
      );
      if (taken !== null) {
        throw new ApiError(
          409,
          "На выбранного врача уже заведён другой пользователь с ролью врач"
        );
      }
      patch.doctorId = rawDoctorId;
    } else if (current.role === "doctor") {
      patch.doctorId = null;
    }

    const updated = await this.usersRepository.update(id, patch);
    if (!updated) return null;

    if (nextRole === "nurse") {
      await this.nursesRepository.upsert(id, nurseDoctorToBind!);
    } else if (current.role === "nurse") {
      await this.nursesRepository.deleteByUserId(id);
    }

    return this.enrichPublicUser(updated);
  }

  async deleteUser(_auth: AuthTokenPayload, id: number): Promise<boolean> {
    if (_auth.role !== "superadmin") {
      throw new ApiError(403, "Only superadmin can delete users");
    }
    await this.requireUserOfOwnClinic(id);
    await this.nursesRepository.deleteByUserId(id);
    return this.usersRepository.delete(id);
  }

  async toggleUserActive(_auth: AuthTokenPayload, id: number) {
    if (_auth.role !== "superadmin") {
      throw new ApiError(403, "Only superadmin can toggle user activity");
    }
    await this.requireUserOfOwnClinic(id);
    const updated = await this.usersRepository.toggleActive(id);
    return updated ? await this.enrichPublicUser(updated) : null;
  }

  async changeUserPassword(_auth: AuthTokenPayload, id: number, newPassword: string) {
    if (_auth.role !== "superadmin") {
      throw new ApiError(403, "Only superadmin can change user passwords");
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      throw new ApiError(400, "Password must be at least 6 characters");
    }
    await this.requireUserOfOwnClinic(id);
    const updated = await this.usersRepository.updatePassword(
      id,
      await hashPassword(newPassword)
    );
    return updated ? await this.enrichPublicUser(updated) : null;
  }
}
