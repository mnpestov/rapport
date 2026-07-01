import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getUnreadMessages, UnreadInfo } from "../api/chat";

interface UnreadContextValue {
  total: number;
  unreadUsers: Set<string>;
  refresh: () => void;
}

const UnreadContext = createContext<UnreadContextValue>({
  total: 0,
  unreadUsers: new Set(),
  refresh: () => {},
});

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [info, setInfo] = useState<UnreadInfo>({ total: 0, users: [] });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await getUnreadMessages();
      setInfo(data);
    } catch {
      // silent — admin may be on a different page
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 20000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  useEffect(() => {
    document.title = info.total > 0 ? `Rapport Admin (${info.total})` : "Rapport Admin";
  }, [info.total]);

  const unreadUsers = new Set(info.users.map((u) => u.telegramId));

  return (
    <UnreadContext.Provider value={{ total: info.total, unreadUsers, refresh: poll }}>
      {children}
    </UnreadContext.Provider>
  );
}

export const useUnread = () => useContext(UnreadContext);
