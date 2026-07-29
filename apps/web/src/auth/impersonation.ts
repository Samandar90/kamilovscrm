/**
 * «Войти как» — подмена токена на клиенте.
 *
 * Токен админа откладывается в тот же storage (local/session), где лежал
 * рабочий токен, под ключом `crm_impersonator_token`; на его место пишется
 * токен целевого пользователя — так `requestJson` подхватывает его без правок.
 * Возврат — обратная замена. После обеих операций делаем полную перезагрузку
 * страницы: все модульные состояния сбрасываются, приложение поднимается
 * под новой личностью через обычный bootstrapAuth.
 */

const TOKEN_KEY = "crm_access_token";
const IMPERSONATOR_TOKEN_KEY = "crm_impersonator_token";
const IMPERSONATOR_NAME_KEY = "crm_impersonator_name";

const bothStorages = (): Storage[] =>
  typeof window === "undefined" ? [] : [window.localStorage, window.sessionStorage];

/** Имя админа, если сейчас активен режим «Войти как» (иначе null). */
export const getImpersonatorName = (): string | null => {
  for (const storage of bothStorages()) {
    if (storage.getItem(IMPERSONATOR_TOKEN_KEY)) {
      return storage.getItem(IMPERSONATOR_NAME_KEY) ?? "";
    }
  }
  return null;
};

export const isImpersonating = (): boolean => getImpersonatorName() !== null;

/**
 * Включить режим: отложить текущий (админский) токен и записать токен цели.
 * Возвращает false, если текущего токена нет (не залогинен) — вызывающий не должен перезагружаться.
 */
export const startImpersonation = (targetToken: string, impersonatorName: string): boolean => {
  for (const storage of bothStorages()) {
    const adminToken = storage.getItem(TOKEN_KEY);
    if (adminToken) {
      storage.setItem(IMPERSONATOR_TOKEN_KEY, adminToken);
      storage.setItem(IMPERSONATOR_NAME_KEY, impersonatorName);
      storage.setItem(TOKEN_KEY, targetToken);
      return true;
    }
  }
  return false;
};

/** Вернуться в свой аккаунт. Возвращает false, если откладывать было нечего. */
export const stopImpersonation = (): boolean => {
  for (const storage of bothStorages()) {
    const adminToken = storage.getItem(IMPERSONATOR_TOKEN_KEY);
    if (adminToken) {
      storage.setItem(TOKEN_KEY, adminToken);
      storage.removeItem(IMPERSONATOR_TOKEN_KEY);
      storage.removeItem(IMPERSONATOR_NAME_KEY);
      return true;
    }
  }
  return false;
};

/** Зачистка следов режима (на logout и на свежий login). */
export const clearImpersonation = (): void => {
  for (const storage of bothStorages()) {
    storage.removeItem(IMPERSONATOR_TOKEN_KEY);
    storage.removeItem(IMPERSONATOR_NAME_KEY);
  }
};
