import React from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);

  const languages = [
    { code: "ru", name: t("components.russian") },
    { code: "uz", name: t("components.uzbek") },
  ];

  const current = languages.find((l) => l.code === i18n.language) || languages[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 max-md:h-8 max-md:py-0 md:px-3"
        title={i18n.t("components.selectLanguage")}
      >
        <Globe size={14} />
        <span className="hidden sm:inline">{current.name}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-lg border border-slate-200 bg-white shadow-lg">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                void i18n.changeLanguage(lang.code);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-2 text-xs font-medium transition ${
                i18n.language === lang.code
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {lang.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
