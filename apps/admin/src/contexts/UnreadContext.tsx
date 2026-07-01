import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getUnreadMessages } from "../api/chat";

interface UnreadContextValue {
  whitelistTotal: number;
  whitelistUsers: Set<string>;
  allTotal: number;
  allUsers: Set<string>;
  refresh: () => void;
}

const UnreadContext = createContext<UnreadContextValue>({
  whitelistTotal: 0,
  whitelistUsers: new Set(),
  allTotal: 0,
  allUsers: new Set(),
  refresh: () => {},
});

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [whitelistTotal, setWhitelistTotal] = useState(0);
  const [whitelistUsers, setWhitelistUsers] = useState<Set<string>>(new Set());
  const [allTotal, setAllTotal] = useState(0);
  const [allUsers, setAllUsers] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await getUnreadMessages();
      setWhitelistTotal(data.whitelist.total);
      setWhitelistUsers(new Set(data.whitelist.users.map((u) => u.telegramId)));
      setAllTotal(data.all.total);
      setAllUsers(new Set(data.all.users.map((u) => u.telegramId)));
    } catch {
      // silent
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
    document.title = allTotal > 0 ? `Rapport Admin (${allTotal})` : "Rapport Admin";
  }, [allTotal]);

  return (
    <UnreadContext.Provider value={{ whitelistTotal, whitelistUsers, allTotal, allUsers, refresh: poll }}>
      {children}
    </UnreadContext.Provider>
  );
}

export const useUnread = () => useContext(UnreadContext);
