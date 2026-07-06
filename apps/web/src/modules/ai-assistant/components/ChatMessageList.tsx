import React from "react";
import { useTranslation } from "react-i18next";

export type ChatUiMessage = {
  role: "user" | "ai";
  text: string;
};

type ChatMessageListProps = {
  messages: ChatUiMessage[];
  loadingHistory?: boolean;
  sending?: boolean;
  onHintClick: (text: string) => void;
  messagesEndRef?: React.RefObject<HTMLDivElement | null>;
};

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  loadingHistory = false,
  sending = false,
  onHintClick,
  messagesEndRef,
}) => {
  const { t } = useTranslation();

  const EMPTY_HINTS = [
    t("ai.hint1Text"),
    t("ai.hint2Text"),
    t("ai.hint3Text"),
  ];

  return (
  <div className="flex h-full min-h-0 flex-1 flex-col p-3 pb-6 lg:pb-3">
    <div className="flex min-h-full flex-col gap-[10px]">
      {loadingHistory ? (
        <p className="py-10 text-center text-sm text-slate-500">{t("ai.loadingChat")}</p>
      ) : null}

      {!loadingHistory && messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center shadow-sm">
          <p className="text-base font-semibold text-slate-900">{t("ai.readyToHelp")}</p>
          <div className="mt-4 flex w-full max-w-sm flex-wrap items-center justify-center gap-2">
            {EMPTY_HINTS.map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => onHintClick(hint)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-100"
              >
                {hint}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {messages.map((message, index) => {
        const isUser = message.role === "user";
        return (
          <div key={`${message.role}-${index}-${message.text.slice(0, 24)}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={[
                "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                isUser
                  ? "bg-emerald-600 text-white shadow-[0_6px_18px_-12px_rgba(5,150,105,0.7)]"
                  : "border border-slate-200 bg-white text-slate-800 shadow-sm",
              ].join(" ")}
            >
              {message.text}
            </div>
          </div>
        );
      })}

      {sending ? (
        <div className="flex justify-start">
          <div className="max-w-[75%] rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500 shadow-sm">
            {t("ai.typing")}
          </div>
        </div>
      ) : null}
      <div ref={messagesEndRef as React.Ref<HTMLDivElement>} className="h-[140px]" />
    </div>
  </div>
  );
};
