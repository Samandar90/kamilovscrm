import React from "react";
import { ClipboardList, FilePlus2, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../auth/AuthContext";
import {
  canCreateQuestionnaires,
  canManageQuestionnaireTemplates,
} from "../../../auth/roleGroups";
import { ListEmptyState } from "../../../components/ui/ListEmptyState";
import { useDebounce } from "../../../shared/lib/useDebounce";
import { appointmentsFlowApi, type Doctor } from "../../appointments/api/appointmentsFlowApi";
import { modalSelectClassInline } from "../../appointments/utils/modalFieldClasses";
import {
  questionnairesApi,
  type PatientQuestionnaireSummary,
  type QuestionnaireTemplate,
} from "../api/questionnairesApi";
import { TemplateEditorModal } from "../components/TemplateEditorModal";
import { useQuestionnaireDialogs } from "../hooks/useQuestionnaireDialogs";

type Tab = "base" | "templates";

const PAGE_SIZE = 30;

const filterControlClass = `${modalSelectClassInline} h-10 py-0`;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });

export const QuestionnairesPage: React.FC = () => {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const role = user?.role;
  const canFill = canCreateQuestionnaires(role);
  const canManageTemplates = canManageQuestionnaireTemplates(role);
  const canBindDoctor = role === "superadmin" || role === "manager";

  const [tab, setTab] = React.useState<Tab>("base");
  const [templates, setTemplates] = React.useState<QuestionnaireTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = React.useState(true);
  const [doctors, setDoctors] = React.useState<Doctor[]>([]);
  const [editor, setEditor] = React.useState<{ template: QuestionnaireTemplate | null } | null>(null);

  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [templateFilter, setTemplateFilter] = React.useState("");
  const [doctorFilter, setDoctorFilter] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [items, setItems] = React.useState<PatientQuestionnaireSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [listLoading, setListLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [listRevision, setListRevision] = React.useState(0);

  const filters = React.useMemo(
    () => ({
      search: debouncedSearch || undefined,
      templateId: templateFilter ? Number(templateFilter) : undefined,
      doctorId: doctorFilter ? Number(doctorFilter) : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [debouncedSearch, templateFilter, doctorFilter, dateFrom, dateTo]
  );
  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  const loadTemplates = React.useCallback(async () => {
    if (!token) return;
    setTemplatesLoading(true);
    try {
      setTemplates(await questionnairesApi.listTemplates(token, canManageTemplates));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.loadFailed"));
    } finally {
      setTemplatesLoading(false);
    }
  }, [token, canManageTemplates, t]);

  React.useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  React.useEffect(() => {
    if (!token) return;
    appointmentsFlowApi
      .listDoctors(token)
      .then(setDoctors)
      .catch(() => setDoctors([]));
  }, [token]);

  React.useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setListLoading(true);
    setError(null);
    questionnairesApi
      .list(token, { ...filters, limit: PAGE_SIZE, offset: 0 }, controller.signal)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [token, filters, listRevision, t]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadMore = async () => {
    if (!token) return;
    const requestFilters = filters;
    setLoadingMore(true);
    try {
      const result = await questionnairesApi.list(token, { ...requestFilters, limit: PAGE_SIZE, offset: items.length });
      // Filters changed while loading: the fresh first page is already being fetched.
      if (filtersRef.current !== requestFilters) return;
      setItems((prev) => [...prev, ...result.items]);
      setTotal(result.total);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("questionnaires.errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  const dialogs = useQuestionnaireDialogs(() => {
    setListRevision((value) => value + 1);
    void loadTemplates();
  });

  const canEditTemplate = (template: QuestionnaireTemplate): boolean => {
    if (!canManageTemplates) return false;
    if (role !== "doctor") return true;
    return template.createdBy === user?.id || (user?.doctorId != null && template.doctorId === user.doctorId);
  };

  const hasFilters = Boolean(search || templateFilter || doctorFilter || dateFrom || dateTo);
  const activeTemplates = templates.filter((template) => template.active);

  const tabClass = (value: Tab) =>
    `rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
      tab === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
    }`;

  return (
    <div className="page-enter space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">{t("questionnaires.title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("questionnaires.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageTemplates ? (
            <button
              type="button"
              onClick={() => setEditor({ template: null })}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              <FilePlus2 className="h-4 w-4" aria-hidden />
              {t("questionnaires.newTemplate")}
            </button>
          ) : null}
          {canFill ? (
            <button
              type="button"
              onClick={() => dialogs.openFill({ kind: "new" })}
              disabled={activeTemplates.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("questionnaires.fill")}
            </button>
          ) : null}
        </div>
      </header>

      <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label={t("questionnaires.title")}>
        <button type="button" role="tab" aria-selected={tab === "base"} className={tabClass("base")} onClick={() => setTab("base")}>
          {t("questionnaires.tabs.base")}
          <span className="ml-1.5 text-xs font-medium text-slate-500">{total}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "templates"}
          className={tabClass("templates")}
          onClick={() => setTab("templates")}
        >
          {t("questionnaires.tabs.templates")}
          <span className="ml-1.5 text-xs font-medium text-slate-500">{templates.length}</span>
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {notice}
        </div>
      ) : null}

      {tab === "base" ? (
        <section className="space-y-4" role="tabpanel">
          <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-6">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("questionnaires.searchPlaceholder")}
                aria-label={t("questionnaires.searchPlaceholder")}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500/55 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <select
              className={filterControlClass}
              value={templateFilter}
              onChange={(event) => setTemplateFilter(event.target.value)}
              aria-label={t("questionnaires.template")}
            >
              <option value="">{t("questionnaires.allTemplates")}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
            <select
              className={filterControlClass}
              value={doctorFilter}
              onChange={(event) => setDoctorFilter(event.target.value)}
              aria-label={t("questionnaires.doctor")}
            >
              <option value="">{t("questionnaires.allDoctors")}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              aria-label={t("questionnaires.dateFrom")}
              className={filterControlClass}
            />
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              aria-label={t("questionnaires.dateTo")}
              className={filterControlClass}
            />
          </div>

          {listLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="h-16 animate-pulse rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <ListEmptyState
              icon={ClipboardList}
              title={hasFilters ? t("questionnaires.noResults") : t("questionnaires.empty.title")}
              description={hasFilters ? undefined : t("questionnaires.empty.description")}
            />
          ) : (
            <>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => dialogs.openView(item.id)}
                      className="grid w-full gap-1 px-4 py-3 text-left transition hover:bg-slate-50 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center md:gap-4"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{item.patientName}</span>
                        <span className="block truncate text-xs text-slate-500">{item.patientPhone ?? "—"}</span>
                      </span>
                      <span className="min-w-0 truncate text-sm text-slate-800">{item.title}</span>
                      <span className="min-w-0 truncate text-xs text-slate-500">
                        {item.doctorName ?? item.createdByName ?? "—"}
                      </span>
                      <span className="flex items-center gap-3 text-xs text-slate-500 md:justify-end">
                        <span>{formatDate(item.createdAt)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                          {t("questionnaires.answeredOf", { answered: item.answeredCount, total: item.questionCount })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {items.length < total ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loadingMore ? t("common.loading") : t("questionnaires.showMore", { count: total - items.length })}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <section role="tabpanel">
          {templatesLoading ? (
            <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
              {[0, 1].map((row) => (
                <div key={row} className="h-32 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <ListEmptyState
              icon={FilePlus2}
              title={t("questionnaires.noTemplates")}
              description={canManageTemplates ? t("questionnaires.noTemplatesHint") : undefined}
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {templates.map((template) => (
                <li key={template.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{template.title}</h3>
                    {!template.active ? (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {t("questionnaires.inactive")}
                      </span>
                    ) : null}
                  </div>
                  {template.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{template.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-500">
                    {template.doctorName ?? t("questionnaires.forAllDoctors")} ·{" "}
                    {t("questionnaires.questionsCount", { count: template.questions.length })} ·{" "}
                    {t("questionnaires.usedCount", { count: template.usageCount })}
                  </p>
                  <div className="mt-3 flex gap-2">
                    {canFill && template.active ? (
                      <button
                        type="button"
                        onClick={() => dialogs.openFill({ kind: "new", templateId: template.id })}
                        className="h-9 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                      >
                        {t("questionnaires.fill")}
                      </button>
                    ) : null}
                    {canEditTemplate(template) ? (
                      <button
                        type="button"
                        onClick={() => setEditor({ template })}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {t("common.edit")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editor && token ? (
        <TemplateEditorModal
          token={token}
          template={editor.template}
          doctors={canBindDoctor ? doctors : null}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setNotice(t("questionnaires.templateSaved"));
            void loadTemplates();
          }}
        />
      ) : null}
      {dialogs.element}
    </div>
  );
};
