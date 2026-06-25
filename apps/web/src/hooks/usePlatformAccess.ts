import { useEffect, useState } from "react";
import { fetchPlatformAccess } from "../api/platformApi";

/**
 * Узнаёт, является ли текущий пользователь платформенным админом (владельцем SaaS).
 * Без модульного кэша — чтобы при смене пользователя в сессии не показать чужой статус.
 */
export const usePlatformAccess = (): { isPlatformAdmin: boolean; loading: boolean } => {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchPlatformAccess()
      .then((r) => {
        if (active) setIsPlatformAdmin(Boolean(r.isPlatformAdmin));
      })
      .catch(() => {
        if (active) setIsPlatformAdmin(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { isPlatformAdmin, loading };
};
