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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

    try {
      const res = await aiAssistantService.ask(text);
      setMessages((prev) => [...prev, { role: "ai", text: res.answer?.trim() || "Ответ не получен." }]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Не удалось получить ответ.");
      setMessages((prev) => [...prev, { role: "ai", text: "Не удалось получить ответ. Попробуйте ещё раз." }]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="chat-wrapper flex h-full min-h-0 w-full flex-1 justify-center px-2 pt-1 md:px-4 md:pt-2">
        <div className="chat-container flex h-full w-full max-w-[700px] min-h-0 flex-col pb-[136px] md:pb-[108px]">
          <div className="shrink-0">
            <AIAssistantHeader trailing={clearChatButton} />
          </div>

          <div
            className="mt-1 h-[calc(100dvh-190px)] min-h-0 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60 md:h-[calc(100dvh-170px)]"
          >
            <ChatMessageList
              messages={messages}
              loadingHistory={loadingHistory}
              sending={sending}
              onHintClick={(text) => void sendMessage(text)}
              messagesEndRef={messagesEndRef}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-[70px] left-0 right-0 z-30 px-[10px] md:bottom-4">
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
