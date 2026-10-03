import React from "react";
import { useNavigate } from "react-router-dom";
import { formatCodeForDisplay, normalizeCodeInput } from "./codeInput";
import { TV_LABELS, TV_TEXT_LANGUAGE, tvLabel } from "./tvLabels";

/** /tv — the screen code is typed once with the TV remote; the display page URL is then bookmarked by the browser. */
export function TvLaunchPage() {
  const navigate = useNavigate();
  const [code, setCode] = React.useState("");
  const complete = code.length === 10;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (complete) navigate(`/tv/${code}`);
  };

  return (
    <div className="qtv-root qtv-launch">
      <form className="qtv-launch-card" onSubmit={submit}>
        <h1 className="qtv-launch-title">{tvLabel("enterCode", TV_TEXT_LANGUAGE)}</h1>
        <input
          id="qtv-code"
          className="qtv-code-input"
          value={formatCodeForDisplay(code)}
          onChange={(event) => setCode(normalizeCodeInput(event.target.value))}
          placeholder={TV_LABELS.codePlaceholder.ru}
          aria-label={tvLabel("enterCode", TV_TEXT_LANGUAGE)}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={11}
        />
        <button type="submit" className="qtv-button" disabled={!complete}>
          {tvLabel("openScreen", TV_TEXT_LANGUAGE)}
        </button>
      </form>
    </div>
  );
}
