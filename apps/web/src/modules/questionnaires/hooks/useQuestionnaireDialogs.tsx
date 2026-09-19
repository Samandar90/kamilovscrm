import React from "react";
import { useAuth } from "../../../auth/AuthContext";
import { canDeleteQuestionnaires, canUpdateQuestionnaires } from "../../../auth/roleGroups";
import { QuestionnaireFillModal, type FillTarget } from "../components/QuestionnaireFillModal";
import { QuestionnaireViewModal } from "../components/QuestionnaireViewModal";

type Dialog = { kind: "view"; id: number } | { kind: "fill"; target: FillTarget };

/** View → edit → saved flow shared by the questionnaires page, patient card and doctor workspace. */
export const useQuestionnaireDialogs = (onChanged: () => void) => {
  const { token, user } = useAuth();
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const close = React.useCallback(() => setDialog(null), []);

  const element =
    token && dialog ? (
      dialog.kind === "view" ? (
        <QuestionnaireViewModal
          token={token}
          questionnaireId={dialog.id}
          canEdit={canUpdateQuestionnaires(user?.role)}
          canDelete={canDeleteQuestionnaires(user?.role)}
          onClose={close}
          onEdit={(questionnaire) => setDialog({ kind: "fill", target: { kind: "edit", questionnaire } })}
          onDeleted={() => {
            close();
            onChanged();
          }}
        />
      ) : (
        <QuestionnaireFillModal
          token={token}
          target={dialog.target}
          onClose={close}
          onSaved={(saved) => {
            setDialog({ kind: "view", id: saved.id });
            onChanged();
          }}
        />
      )
    ) : null;

  return {
    openView: React.useCallback((id: number) => setDialog({ kind: "view", id }), []),
    openFill: React.useCallback((target: FillTarget) => setDialog({ kind: "fill", target }), []),
    element,
  };
};
