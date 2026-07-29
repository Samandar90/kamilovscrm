import React from "react";
import { useTranslation } from "react-i18next";
import { requestJson } from "../../../api/http";
import { authApi } from "../../../api/authApi";
import { useAuth } from "../../../auth/AuthContext";
import { startImpersonation } from "../../../auth/impersonation";
import type { UserRole } from "../../../auth/types";
import { USER_ROLES } from "../../../auth/permissions";
import { Modal } from "../../../components/ui/Modal";

type User = {
  id: number;
  fullName?: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  doctorId?: number | null;
  nurseDoctorId?: number | null;
  lastLoginAt?: string | null;
  createdAt: string;
};

type DoctorRow = { id: number; name: string };

type UserFormState = {
  fullName: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  password: string;
  doctorId: number | "";
};
type UserFieldErrors = Partial<
  Record<"fullName" | "username" | "password" | "role" | "doctorId", string>
>;
type PasswordFormState = { password: string; confirmPassword: string };
type PasswordFieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

const ROLES: UserRole[] = [...USER_ROLES];

const initialFormState: UserFormState = {
  fullName: "",
  username: "",
  role: "manager",
  isActive: true,
  password: "",
  doctorId: "",
};

const formatCreatedAt = (iso: string): string => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
};
const formatLoginAt = (iso?: string | null): string => {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const roleChipClass = (role: UserRole): string => {
  if (role === "superadmin") return "bg-violet-50 text-violet-700 border-violet-100";
  if (role === "doctor" || role === "nurse") return "bg-blue-50 text-blue-700 border-blue-100";
  if (role === "cashier" || role === "accountant") return "bg-amber-50 text-amber-700 border-amber-100";
  if (role === "reception" || role === "operator") return "bg-sky-50 text-sky-800 border-sky-100";
  if (role === "director") return "bg-indigo-50 text-indigo-800 border-indigo-100";
  return "bg-slate-50 text-slate-700 border-slate-100";
};

const statusChipClass = (isActive: boolean): string =>
  isActive
    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
    : "bg-slate-100 text-slate-600 border-slate-200";

export const UsersPage: React.FC = () => {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [users, setUsers] = React.useState<User[]>([]);
  const [impersonatingId, setImpersonatingId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<number | null>(null);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = React.useState(false);
  const [passwordUserId, setPasswordUserId] = React.useState<number | null>(null);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState<UserFormState>(initialFormState);
  const [fieldErrors, setFieldErrors] = React.useState<UserFieldErrors>({});
  const [passwordForm, setPasswordForm] = React.useState<PasswordFormState>({
    password: "",
    confirmPassword: "",
  });
  const [passwordErrors, setPasswordErrors] = React.useState<PasswordFieldErrors>({});
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [doctorsList, setDoctorsList] = React.useState<DoctorRow[]>([]);
  const [doctorsLoading, setDoctorsLoading] = React.useState(false);

  React.useEffect(() => {
    if (!modalOpen) return;
    setDoctorsLoading(true);
    void (async () => {
      try {
        const rows = await requestJson<DoctorRow[]>("/api/doctors");
        setDoctorsList(Array.isArray(rows) ? rows : []);
      } catch {
        setDoctorsList([]);
      } finally {
        setDoctorsLoading(false);
      }
    })();
  }, [modalOpen]);

  React.useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const usersRows = await requestJson<User[]>(`/api/users${q}`);
      setUsers(usersRows);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("users.errorLoading"));
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(initialFormState);
    setFieldErrors({});
  };
  const closePasswordModal = () => {
    setPasswordModalOpen(false);
    setPasswordUserId(null);
    setPasswordForm({ password: "", confirmPassword: "" });
    setPasswordErrors({});
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(initialFormState);
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingId(user.id);
    setForm({
      fullName: user.fullName ?? "",
      username: user.username,
      role: user.role,
      isActive: user.isActive,
      password: "",
      doctorId:
        user.role === "doctor" && user.doctorId != null
          ? user.doctorId
          : user.role === "nurse" && user.nurseDoctorId != null
            ? user.nurseDoctorId
            : "",
    });
    setFieldErrors({});
    setModalOpen(true);
  };
  const openChangePassword = (user: User) => {
    setPasswordUserId(user.id);
    setPasswordForm({ password: "", confirmPassword: "" });
    setPasswordErrors({});
    setPasswordModalOpen(true);
  };

  const saveUser = async () => {
    const nextFieldErrors: UserFieldErrors = {};
    if (!form.fullName.trim()) nextFieldErrors.fullName = t("users.fullNameRequired");
    if (!form.username.trim()) nextFieldErrors.username = t("users.usernameRequired");
    if (!form.role) nextFieldErrors.role = t("users.roleRequired");
    if (form.role === "doctor" || form.role === "nurse") {
      if (form.doctorId === "" || form.doctorId === undefined) {
        nextFieldErrors.doctorId = t("users.selectDoctorFromList");
      }
    }
    if (!editingId && !form.password.trim()) {
      nextFieldErrors.password = t("users.passwordRequired");
    } else if (!editingId && form.password.trim().length < 6) {
      nextFieldErrors.password = t("users.passwordMinimum");
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError(null);
      return;
    }

    const payload = {
      fullName: form.fullName.trim(),
      username: form.username.trim(),
      role: form.role,
      isActive: form.isActive,
      ...((form.role === "doctor" || form.role === "nurse") && form.doctorId !== ""
        ? { doctor_id: form.doctorId as number }
        : {}),
    };

    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await requestJson<User>(`/api/users/${editingId}`, {
          method: "PUT",
          body: {
            fullName: payload.fullName,
            role: payload.role,
            isActive: payload.isActive,
            ...((form.role === "doctor" || form.role === "nurse") && form.doctorId !== ""
              ? { doctor_id: form.doctorId as number }
              : {}),
          },
        });
        setToast(t("users.userUpdated"));
      } else {
        await requestJson<User>("/api/users", {
          method: "POST",
          body: { ...payload, password: form.password.trim() },
        });
        setToast(t("users.userCreated"));
      }
      closeModal();
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("users.savingError"));
    } finally {
      setIsSaving(false);
    }
  };
  const savePassword = async () => {
    const nextErrors: PasswordFieldErrors = {};
    if (!passwordForm.password.trim()) {
      nextErrors.password = t("users.enterNewPassword");
    } else if (passwordForm.password.trim().length < 6) {
      nextErrors.password = t("users.passwordMinimum");
    }
    if (!passwordForm.confirmPassword.trim()) {
      nextErrors.confirmPassword = t("users.confirmPassword");
    } else if (passwordForm.confirmPassword !== passwordForm.password) {
      nextErrors.confirmPassword = t("users.passwordsDoNotMatch");
    }
    setPasswordErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || passwordUserId == null) return;

    setIsSaving(true);
    setError(null);
    try {
      await requestJson<User>(`/api/users/${passwordUserId}/password`, {
        method: "PATCH",
        body: { password: passwordForm.password },
      });
      closePasswordModal();
      setToast(t("users.passwordUpdated"));
      await loadData();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : t("users.passwordChangeError")
      );
    } finally {
      setIsSaving(false);
    }
  };

  const toggleUser = async (user: User) => {
    if (togglingId !== null) return;
    setError(null);
    setTogglingId(user.id);
    try {
      await requestJson<User>(`/api/users/${user.id}/toggle-active`, { method: "PATCH" });
      await loadData();
      setToast(user.isActive ? t("users.userDisabled") : t("users.userEnabled"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("users.statusChangeError"));
    } finally {
      setTogglingId(null);
    }
  };

  const deleteUser = async (user: User) => {
    if (deletingId !== null) return;
    const confirmed = window.confirm(t("users.confirmDelete", { username: user.username }));
    if (!confirmed) return;
    setError(null);
    setDeletingId(user.id);
    try {
      await requestJson<{ success: boolean }>(`/api/users/${user.id}`, { method: "DELETE" });
      await loadData();
      setToast(t("users.userDeleted"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("users.deletionError"));
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * «Войти как»: сервер выдаёт токен цели, свой токен откладываем и
   * перезагружаемся на дашборд уже под выбранным пользователем.
   * Пароль цели не участвует и не меняется.
   */
  const canImpersonate = (user: User): boolean =>
    me?.role === "superadmin" && user.id !== me.id && user.role !== "superadmin" && user.isActive;

  const impersonate = async (user: User) => {
    if (impersonatingId !== null) return;
    setError(null);
    setImpersonatingId(user.id);
    try {
      const response = await authApi.impersonate(user.id);
      if (!response.accessToken) {
        throw new Error(t("users.impersonateError"));
      }
      if (!startImpersonation(response.accessToken, me?.fullName ?? me?.username ?? "")) {
        throw new Error(t("users.impersonateError"));
      }
      window.location.replace("/dashboard");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("users.impersonateError"));
      setImpersonatingId(null);
    }
  };

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[#0f172a]">{t("users.title")}</h2>
          <p className="text-sm text-[#64748b]">
            {t("users.subtitle")}
          </p>
        </div>
        <button
          className="rounded-lg bg-[#0f172a] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#1e293b] disabled:opacity-50"
          onClick={openCreate}
          disabled={isSaving || deletingId !== null || togglingId !== null}
        >
          ➕ {t("users.addUser")}
        </button>
      </header>

      <div className="rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a] outline-none transition focus:border-[#94a3b8]"
          placeholder={t("users.searchPlaceholder")}
        />
      </div>

      {toast && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {toast}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="h-11 animate-pulse rounded-lg bg-[#f1f5f9]" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
            <div className="text-2xl">👥</div>
            <div className="font-medium text-[#0f172a]">{t("users.noUsers")}</div>
            <p className="text-sm text-[#64748b]">{t("users.addFirstUserToStart")}</p>
            <button
              className="mt-2 rounded-lg bg-[#0f172a] px-3 py-2 text-sm font-medium text-white hover:bg-[#1e293b] disabled:opacity-50"
              onClick={openCreate}
              disabled={isSaving || deletingId !== null || togglingId !== null}
            >
              ➕ {t("users.addUser")}
            </button>
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
              <tr>
                <th className="px-4 py-3">{t("users.fullName")}</th>
                <th className="px-3 py-2">{t("users.username")}</th>
                <th className="px-3 py-2">{t("users.role")}</th>
                <th className="px-3 py-2">{t("users.doctorProfile")}</th>
                <th className="px-3 py-2">{t("users.status")}</th>
                <th className="px-3 py-2">{t("users.createdAt")}</th>
                <th className="px-3 py-2">{t("users.lastLogin")}</th>
                <th className="px-3 py-2">{t("users.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-[#eef2f7]">
                  <td className="px-4 py-3 font-medium text-[#0f172a]">{user.fullName ?? user.username}</td>
                  <td className="px-3 py-2 text-[#334155]">{user.username}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${roleChipClass(user.role)}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[#64748b]">
                    {user.role === "doctor" && user.doctorId != null
                      ? `#${user.doctorId}`
                      : user.role === "nurse" && user.nurseDoctorId != null
                        ? `#${user.nurseDoctorId}`
                        : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusChipClass(user.isActive)}`}>
                      {user.isActive ? t("users.active") : t("users.inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[#64748b]">{formatCreatedAt(user.createdAt)}</td>
                  <td className="px-3 py-2 text-[#64748b]">{formatLoginAt(user.lastLoginAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {canImpersonate(user) ? (
                        <button
                          className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                          onClick={() => void impersonate(user)}
                          disabled={
                            isSaving ||
                            deletingId !== null ||
                            togglingId !== null ||
                            impersonatingId !== null
                          }
                        >
                          {impersonatingId === user.id ? "..." : t("users.impersonate")}
                        </button>
                      ) : null}
                      <button
                        className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs text-[#334155] hover:bg-[#f8fafc]"
                        onClick={() => openEdit(user)}
                        disabled={isSaving || deletingId !== null || togglingId !== null}
                      >
                        {t("users.edit")}
                      </button>
                      <button
                        className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs text-[#334155] hover:bg-[#f8fafc]"
                        onClick={() => openChangePassword(user)}
                        disabled={isSaving || deletingId !== null || togglingId !== null}
                      >
                        {t("users.changePassword")}
                      </button>
                      <button
                        className="rounded-md border border-[#e2e8f0] px-2 py-1 text-xs text-[#475569] hover:bg-[#f8fafc]"
                        onClick={() => void toggleUser(user)}
                        disabled={isSaving || deletingId !== null || togglingId !== null}
                      >
                        {togglingId === user.id
                          ? "..."
                          : user.isActive
                            ? t("users.disable")
                            : t("users.enable")}
                      </button>
                      <button
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        onClick={() => void deleteUser(user)}
                        disabled={isSaving || deletingId !== null || togglingId !== null}
                      >
                        {deletingId === user.id ? t("users.deleting") : t("users.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        className="w-full max-w-2xl rounded-xl border border-[#e2e8f0] bg-white p-5"
      >
        <h3 className="text-lg font-semibold text-[#0f172a]">
          {editingId ? t("users.editUser") : t("users.addUser")}
        </h3>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <input
              className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
              placeholder={t("users.fullName")}
              value={form.fullName}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, fullName: event.target.value }));
                setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
              }}
            />
            {fieldErrors.fullName && <p className="mt-1 text-xs text-rose-600">{fieldErrors.fullName}</p>}
          </div>
          <div>
            <input
              className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
              aria-label="username"
              placeholder={t("users.username")}
              value={form.username}
              disabled={editingId !== null}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, username: event.target.value }));
                setFieldErrors((prev) => ({ ...prev, username: undefined }));
              }}
            />
            {fieldErrors.username && <p className="mt-1 text-xs text-rose-600">{fieldErrors.username}</p>}
          </div>
          {!editingId && (
            <div>
              <input
                type="password"
                className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
                aria-label="password"
                placeholder={t("users.passwordPlaceholder")}
                value={form.password}
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, password: event.target.value }));
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
              />
              {fieldErrors.password && <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>}
            </div>
          )}
          <div>
            <select
              className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
              value={form.role}
              onChange={(event) => {
                const nextRole = event.target.value as UserRole;
                setForm((prev) => ({
                  ...prev,
                  role: nextRole,
                  doctorId:
                    nextRole === "doctor" || nextRole === "nurse" ? prev.doctorId : "",
                }));
                setFieldErrors((prev) => ({ ...prev, role: undefined, doctorId: undefined }));
              }}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            {fieldErrors.role && <p className="mt-1 text-xs text-rose-600">{fieldErrors.role}</p>}
          </div>
          {form.role === "doctor" || form.role === "nurse" ? (
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-[#64748b]">{t("users.doctorProfile")}</label>
              <select
                className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
                value={form.doctorId === "" ? "" : String(form.doctorId)}
                disabled={doctorsLoading}
                onChange={(event) => {
                  const v = event.target.value;
                  setForm((prev) => ({
                    ...prev,
                    doctorId: v === "" ? "" : Number(v),
                  }));
                  setFieldErrors((prev) => ({ ...prev, doctorId: undefined }));
                }}
              >
                <option value="">{doctorsLoading ? t("users.loading") : t("users.selectDoctor")}</option>
                {doctorsList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {fieldErrors.doctorId && (
                <p className="mt-1 text-xs text-rose-600">{fieldErrors.doctorId}</p>
              )}
            </div>
          ) : null}
          <label className="text-sm text-[#475569] md:col-span-2">
            <input
              type="checkbox"
              className="mr-2"
              checked={form.isActive}
              onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
            />
            {t("users.active")}
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-sm text-[#475569] hover:bg-[#f8fafc]"
            onClick={closeModal}
            disabled={isSaving}
          >
            {t("users.cancel")}
          </button>
          <button
            className="rounded-md bg-[#0f172a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1e293b] disabled:opacity-50"
            onClick={() => void saveUser()}
            disabled={isSaving}
          >
            {t("users.save")}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={passwordModalOpen}
        onClose={closePasswordModal}
        className="w-full max-w-md rounded-xl border border-[#e2e8f0] bg-white p-5"
      >
        <h3 className="text-lg font-semibold text-[#0f172a]">{t("users.changePassword")}</h3>
        <div className="mt-4 space-y-3">
          <div>
            <input
              type="password"
              className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
              placeholder={t("users.newPassword")}
              value={passwordForm.password}
              onChange={(event) => {
                setPasswordForm((prev) => ({ ...prev, password: event.target.value }));
                setPasswordErrors((prev) => ({ ...prev, password: undefined }));
              }}
            />
            {passwordErrors.password && (
              <p className="mt-1 text-xs text-rose-600">{passwordErrors.password}</p>
            )}
          </div>
          <div>
            <input
              type="password"
              className="w-full rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm text-[#0f172a]"
              placeholder={t("users.confirmPasswordPlaceholder")}
              value={passwordForm.confirmPassword}
              onChange={(event) => {
                setPasswordForm((prev) => ({
                  ...prev,
                  confirmPassword: event.target.value,
                }));
                setPasswordErrors((prev) => ({ ...prev, confirmPassword: undefined }));
              }}
            />
            {passwordErrors.confirmPassword && (
              <p className="mt-1 text-xs text-rose-600">{passwordErrors.confirmPassword}</p>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-sm text-[#475569] hover:bg-[#f8fafc]"
            onClick={closePasswordModal}
            disabled={isSaving}
          >
            {t("users.cancel")}
          </button>
          <button
            className="rounded-md bg-[#0f172a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1e293b] disabled:opacity-50"
            onClick={() => void savePassword()}
            disabled={isSaving}
          >
            {t("users.save")}
          </button>
        </div>
      </Modal>
    </div>
  );
};
