import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useAuth } from "../../../auth/AuthContext";
import { aiAssistantService } from "../services/aiAssistantService";
import { AIAssistantHeader } from "../components/AIAssistantHeader";
import { ChatInputBar } from "../components/ChatInputBar";
import { ChatMessageList, type ChatUiMessage } from "../components/ChatMessageList";

export const AIAssistantPage = () => {
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    cards: Array<{ key: string; label: string; value: string }>;
    recommendationText: string;
  } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 50);
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setMessages([]);
      setLoadingHistory(false);
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    setChatError(null);
    void aiAssistantService
      .listMessages()
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows.map((m) => ({ role: m.role === "assistant" ? "ai" : "user", text: m.content })));
      })
      .catch(() => {
        if (!cancelled) setChatError("Не удалось загрузить историю чата.");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!loadingHistory) {
      scrollToBottom();
    }
  }, [loadingHistory, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(null);
    void aiAssistantService
      .summary()
      .then((data) => {
        if (cancelled) return;
        setSummary({
          cards: data.cards.map((c) => ({ key: c.key, label: c.label, value: c.value })),
          recommendationText: data.recommendationText ?? "",
        });
      })
      .catch(() => {
        if (!cancelled) setSummaryError("Не удалось загрузить аналитику.");
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearChat = useCallback(() => {
    setChatError(null);
    setInput("");
    void aiAssistantService.clearMessages().then(() => {
      setMessages([]);
    });
  }, []);

  const sendMessage = useCallback(async (forcedText?: string) => {
    const text = (forcedText ?? input).trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);
    setChatError(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    scrollToBottom();

    try {
      const res = await aiAssistantService.ask(text);
      setMessages((prev) => [...prev, { role: "ai", text: res.answer?.trim() || "Ответ не получен." }]);
      scrollToBottom();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Не удалось получить ответ.");
      setMessages((prev) => [...prev, { role: "ai", text: "Не удалось получить ответ. Попробуйте ещё раз." }]);
      scrollToBottom();
    } finally {
      setSending(false);
    }
  }, [input, sending, scrollToBottom]);

  const handleSend = () => {
    void sendMessage();
  };

  const clearChatButton = (
    <button
      type="button"
      onClick={clearChat}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/60 text-slate-400 shadow-sm backdrop-blur-md transition-all duration-200 hover:border-red-200/60 hover:bg-red-50/80 hover:text-red-600 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300/50"
      title="Очистить чат"
      aria-label="Очистить чат"
    >
      <Trash2 className="h-[17px] w-[17px]" strokeWidth={1.75} />
    </button>
  );

  const analyticsByKey = (key: string) => summary?.cards.find((card) => card.key === key)?.value ?? "—";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 max-md:[&_button]:min-h-[44px]">
      <div className="flex h-full min-h-0 w-full flex-1 px-2 pt-2 md:px-4 md:pt-2">
        <div className="mx-auto grid h-full w-full max-w-[1120px] min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="chat-wrapper flex h-full min-h-0 w-full justify-center">
            <div className="chat-container flex h-[calc(100dvh-80px)] w-full max-w-[720px] min-h-0 flex-col">
              <div className="sticky top-0 z-50 shrink-0 bg-slate-50 pb-1">
                <AIAssistantHeader trailing={clearChatButton} />
              </div>

              <div className="mt-1 flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60 pb-[160px] lg:pb-0">
                <ChatMessageList
                  messages={messages}
                  loadingHistory={loadingHistory}
                  sending={sending}
                  onHintClick={(text) => void sendMessage(text)}
                  messagesEndRef={messagesEndRef}
                />
              </div>

              <div className="mt-1 hidden shrink-0 border-t border-slate-200 bg-white p-3 lg:block">
                {chatError ? <p className="pb-1 text-center text-xs font-medium text-red-600">{chatError}</p> : null}
                <ChatInputBar
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSend}
                  disabled={sending || loadingHistory}
                  placeholder="Спросите про выручку, пациентов..."
                  size="desktop"
                />
              </div>
            </div>
          </div>

          <aside className="hidden h-[calc(100dvh-80px)] min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">
            <section>
              <h2 className="text-sm font-semibold text-slate-900">Аналитика сегодня</h2>
              {summaryLoading ? <p className="mt-2 text-xs text-slate-500">Загрузка...</p> : null}
              {summaryError ? <p className="mt-2 text-xs text-rose-600">{summaryError}</p> : null}
              {!summaryLoading && !summaryError ? (
                <div className="mt-3 space-y-2.5">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Выручка</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{analyticsByKey("revenueToday")}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Пациенты</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{analyticsByKey("appointmentsToday")}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Статус</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{analyticsByKey("noShow30d")}</p>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-semibold text-slate-900">Подсказки</h3>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => void sendMessage("Какая выручка сегодня?")}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Какая выручка сегодня?
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage("Сколько пациентов сегодня?")}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Сколько пациентов сегодня?
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage("Какие приёмы требуют внимания сейчас?")}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Какие приёмы требуют внимания сейчас?
                </button>
              </div>
              {summary?.recommendationText ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                  {summary.recommendationText}
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </div>

      <div className="fixed bottom-[70px] left-0 right-0 z-50 px-[10px] lg:hidden">
        <div className="mx-auto w-full max-w-[700px] rounded-2xl bg-white/90 backdrop-blur-sm">
          {chatError ? <p className="pb-1 text-center text-xs font-medium text-red-600">{chatError}</p> : null}
          <ChatInputBar
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            disabled={sending || loadingHistory}
            placeholder="Спросите про выручку, пациентов..."
          />
        </div>
      </div>
    </div>
  );
};

export default AIAssistantPage;
