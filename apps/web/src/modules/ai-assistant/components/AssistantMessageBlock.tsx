import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatMessage, AI_CHAT_GUTTER } from "./ChatMessage";
import { AiMessageActions } from "./AiMessageActions";
import { MessageActions } from "./MessageActions";
import { SuggestionChips } from "./SuggestionChips";
import { TypingInline } from "./TypingIndicator";
import { useTypingEffect } from "../hooks/useTypingEffect";
import { getActionsForMessage } from "../utils/getActionsForMessage";
import { cn } from "../../../ui/utils/cn";
import type { ThreadMessage } from "../types";

export type AssistantMessageBlockProps = {
  message: ThreadMessage;
  index: number;
  onFinalizeStream: (id: string) => void;
  onStreamProgress: () => void;
  onSuggestionPick: (text: string) => void;
  onRunAction: (msg: ThreadMessage) => void;
  sending: boolean;
};

export const AssistantMessageBlock: React.FC<AssistantMessageBlockProps> = ({
  message,
  index,
  onFinalizeStream,
  onStreamProgress,
  onSuggestionPick,
  onRunAction,
  sending,
}) => {
  const { t } = useTranslation(["ai"]);
  const streamSource = message.streamText ?? "";
  const isStreaming = Boolean(message.streamText);

  const { displayedText, isComplete } = useTypingEffect(streamSource, {
    msPerChar: 14,
    onComplete: isStreaming ? () => onFinalizeStream(message.id) : undefined,
    onProgress: isStreaming ? onStreamProgress : undefined,
  });

  const bubbleText = isStreaming ? (displayedText || "\u00a0") : message.text;
  const showTypingHint = isStreaming && !isComplete;
  const showFollowUps = !isStreaming;
  const fullAssistantText = message.streamText ?? message.text;
  const showDoneBadge = showFollowUps && fullAssistantText.startsWith("✔");

  const ruleActions = useMemo(() => getActionsForMessage(message, t), [message.text, message.streamText, t]);

  return (
    <div className="space-y-2.5">
      <ChatMessage role="assistant" index={index}>
        {bubbleText}
      </ChatMessage>

      {showTypingHint ? <TypingInline label={t("aiAssistant.aiTyping")} /> : null}

      {showDoneBadge ? (
        <div
          className={cn(
            AI_CHAT_GUTTER,
            "inline-flex rounded-full border border-emerald-200/60 bg-emerald-50/70 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 backdrop-blur-sm"
          )}
        >
          {t("aiAssistant.done")}
        </div>
      ) : null}

      {message.role === "assistant" && message.suggestions && message.suggestions.length > 0 && showFollowUps ? (
        <div className="space-y-1.5">
          <p className={cn(AI_CHAT_GUTTER, "text-[11px] font-semibold uppercase tracking-wide text-slate-400")}>
            {t("aiAssistant.nextInCrm")}
          </p>
          <SuggestionChips labels={message.suggestions} disabled={sending} onSelect={onSuggestionPick} />
        </div>
      ) : null}

      {message.role === "assistant" && message.action && showFollowUps ? (
        <MessageActions action={message.action} onAction={() => onRunAction(message)} />
      ) : null}

      {message.role === "assistant" && showFollowUps && ruleActions.length > 0 ? (
        <div className="space-y-1.5">
          <p className={cn(AI_CHAT_GUTTER, "text-[11px] font-semibold uppercase tracking-wide text-slate-400")}>
            {t("aiAssistant.quickActions")}
          </p>
          <AiMessageActions actions={ruleActions} disabled={sending} />
        </div>
      ) : null}
    </div>
  );
};
