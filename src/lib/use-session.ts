"use client";

import { useEffect, useState } from "react";
import type { Role } from "./domain";

export type SessionUser = { id: string; email: string; name: string; role: Role };

export function useSession() {
  const [user, setUser] = useState<SessionUser>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/session", { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) {
          window.location.assign("/login");
          return undefined;
        }
        if (!response.ok) throw new Error("无法读取当前账号");
        return (await response.json()).data as SessionUser;
      })
      .then(result => result && setUser(result))
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  return { user, loading };
}
