import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";
import { dbPool } from "../config/database";
import type { INursesRepository } from "../repositories/interfaces/INursesRepository";
import type { IUsersRepository } from "../repositories/interfaces/IUsersRepository";
import type {
  AuthResponse,
  AuthTokenPayload,
  LoginInput,
  PublicUser,
  User,
} from "../repositories/interfaces/userTypes";
import { signAccessToken } from "../utils/jwt";
import { verifyPassword } from "../utils/password";
import { toPublicUser } from "../utils/userSanitizer";

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const normalizeClientIp = (ip: string | undefined): string | null =>
  ip && ip.trim() ? ip.trim() : null;

const addMinutesIso = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString();

const mockAuditLogs: Array<{
  userId: number | null;
  username: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  reason: string;
  createdAt: string;
}> = [];

export class AuthService {
  constructor(
    private readonly usersRepository: IUsersRepository,
    private readonly nursesRepository: INursesRepository
  ) {}

  private async logAudit(params: {
    userId: number | null;
    username: string;
    success: boolean;
    ip: string | null;
    userAgent: string | null;
    reason: string;
  }): Promise<void> {
    if (env.dataProvider === "postgres") {
      await dbPool.query(
        `
          INSERT INTO login_audit_logs (user_id, username, success, ip, user_agent, reason)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          params.userId,
          params.username,
          params.success,
          params.ip,
          params.userAgent,
          params.reason,
        ]
      );
      return;
    }
    mockAuditLogs.push({ ...params, createdAt: new Date().toISOString() });
  }

  private async registerFailedAttempt(user: User): Promise<void> {
    const nextFails = (user.failedLoginAttempts ?? 0) + 1;
    const shouldLock = nextFails >= MAX_FAILED_LOGIN_ATTEMPTS;
    await this.usersRepository.updateSecurityState(user.id, {
      failedLoginAttempts: nextFails,
      ...(shouldLock ? { lockedUntil: addMinutesIso(LOCK_MINUTES) } : {}),
    });
  }

  private async resetSecurityOnSuccess(user: User): Promise<void> {
    await this.usersRepository.updateSecurityState(user.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date().toISOString(),
    });
  }

  async validateCredentials(
    username: string,
    password: string,
    meta?: {
      ip?: string;
      userAgent?: string;
    }
  ): Promise<User> {
    const user = await this.usersRepository.findByUsernameIncludingInactive(username);
    // eslint-disable-next-line no-console
    console.log(
      "USER:",
      user
        ? {
            id: user.id,
            username: user.username,
            isActive: user.isActive,
            hasPasswordField: Boolean(user.password),
            passwordStorage: user.password?.startsWith("$2") ? "bcrypt" : "legacy_plaintext",
          }
        : null
    );
    if (!user) {
      await this.logAudit({
        userId: null,
        username,
        success: false,
        ip: normalizeClientIp(meta?.ip),
        userAgent: meta?.userAgent ?? null,
        reason: "invalid_username",
      });
      throw new ApiError(401, "Invalid credentials");
    }
    if (!user.isActive) {
      await this.logAudit({
        userId: user.id,
        username,
        success: false,
        ip: normalizeClientIp(meta?.ip),
        userAgent: meta?.userAgent ?? null,
        reason: "inactive_user",
      });
      throw new ApiError(403, "User is inactive");
    }
    const lockedUntil = user.lockedUntil ? Date.parse(user.lockedUntil) : NaN;
    if (!Number.isNaN(lockedUntil) && lockedUntil > Date.now()) {
      await this.logAudit({
        userId: user.id,
        username,
        success: false,
        ip: normalizeClientIp(meta?.ip),
        userAgent: meta?.userAgent ?? null,
        reason: "account_locked",
      });
      throw new ApiError(429, "Too many login attempts. Please try again later.");
    }

    const isMatch = await verifyPassword(password, user.password);
    if (!isMatch) {
      await this.registerFailedAttempt(user);
      await this.logAudit({
        userId: user.id,
        username,
        success: false,
        ip: normalizeClientIp(meta?.ip),
        userAgent: meta?.userAgent ?? null,
        reason: "invalid_password",
      });
      throw new ApiError(401, "Invalid credentials");
    }

    return user;
  }

  async login(
    input: LoginInput,
    meta?: { ip?: string; userAgent?: string }
  ): Promise<AuthResponse> {
    const user = await this.validateCredentials(input.username, input.password, meta);
    const response = await this.issueAccessResponse(user);
    await this.resetSecurityOnSuccess(user);

    await this.logAudit({
      userId: user.id,
      username: user.username,
      success: true,
      ip: normalizeClientIp(meta?.ip),
      userAgent: meta?.userAgent ?? null,
      reason: "success",
    });
    return response;
  }

  private async buildTokenPayload(user: User): Promise<AuthTokenPayload> {
    if (!Number.isInteger(user.clinicId) || user.clinicId <= 0) {
      throw new ApiError(403, "User clinic is not configured");
    }
    const base: AuthTokenPayload = {
      userId: user.id,
      clinicId: user.clinicId,
      username: user.username,
      role: user.role,
      doctorId: user.role === "doctor" ? user.doctorId ?? null : null,
    };
    if (user.role === "nurse") {
      const nid = await this.nursesRepository.findDoctorIdByUserId(user.id);
      if (nid == null) {
        throw new ApiError(403, "Учётная запись медсестры не привязана к врачу");
      }
      return { ...base, nurseDoctorId: nid };
    }
    return base;
  }

  private async issueAccessResponse(user: User): Promise<AuthResponse> {
    const payload = await this.buildTokenPayload(user);
    const accessToken = signAccessToken(payload);
    // eslint-disable-next-line no-console
    console.log("JWT CREATED:", Boolean(accessToken && accessToken.length > 0));
    const publicBase = toPublicUser(user);
    if (user.role === "nurse") {
      return {
        accessToken,
        user: {
          ...publicBase,
          nurseDoctorId: payload.nurseDoctorId ?? null,
        },
      };
    }
    return { accessToken, user: publicBase };
  }

  async getAuditLogs(auth: AuthTokenPayload): Promise<
    Array<{
      userId: number | null;
      username: string;
      success: boolean;
      ip: string | null;
      userAgent: string | null;
      reason: string;
      createdAt: string;
    }>
  > {
    if (auth.role !== "superadmin") {
      throw new ApiError(403, "Only superadmin can view auth audit logs");
    }
    if (env.dataProvider === "postgres") {
      const result = await dbPool.query<{
        user_id: number | null;
        username: string;
        success: boolean;
        ip: string | null;
        user_agent: string | null;
        reason: string;
        created_at: string;
      }>(
        `
          SELECT user_id, username, success, ip, user_agent, reason, created_at
          FROM login_audit_logs
          ORDER BY created_at DESC
          LIMIT 500
        `
      );
      return result.rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        success: r.success,
        ip: r.ip,
        userAgent: r.user_agent,
        reason: r.reason,
        createdAt: r.created_at,
      }));
    }
    return [...mockAuditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getMe(auth: AuthTokenPayload): Promise<PublicUser> {
    const user = await this.usersRepository.findById(auth.userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    if (!user.isActive) {
      throw new ApiError(403, "User is inactive");
    }
    const base = toPublicUser(user);
    if (user.role === "nurse") {
      const nid = await this.nursesRepository.findDoctorIdByUserId(user.id);
      return { ...base, nurseDoctorId: nid };
    }
    return base;
  }
}
