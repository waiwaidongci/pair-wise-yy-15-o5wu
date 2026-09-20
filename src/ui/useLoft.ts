import { useCallback, useEffect, useState } from "react";
import { repository } from "../storage/repository";
import type {
  Batch,
  Database,
  Entry,
  ParamArchive,
  Pigeon,
} from "../domain/types";

export interface Toast {
  id: number;
  kind: "ok" | "error";
  status?: number;
  message: string;
}

export interface LoftState {
  ready: boolean;
  pigeons: Pigeon[];
  batches: Batch[];
  entries: Entry[];
  archives: ParamArchive[];
}

/**
 * 页面与存储之间唯一的状态通道：每次存储层落库后重新拉取整份快照，
 * 所有视图都从同一快照 + 同一规则函数推导，刷新后一致。
 */
export function useLoft(): LoftState & {
  toasts: Toast[];
  resetDemo: () => Promise<void>;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
} {
  const [db, setDb] = useState<Database | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refresh = useCallback(async () => {
    const snap = await repository.list();
    setDb({ version: 1, ...snap });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 存储层落库后广播，页面订阅刷新（409/400 不落库则不会触发）
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("loft:changed", handler);
    return () => window.removeEventListener("loft:changed", handler);
  }, [refresh]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const resetDemo = useCallback(async () => {
    const res = await repository.reset();
    if (res.ok) {
      setDb({
        version: 1,
        pigeons: res.data.pigeons,
        batches: res.data.batches,
        entries: res.data.entries,
        archives: res.data.archives,
      } satisfies Database);
    }
  }, []);

  return {
    ready: db != null,
    pigeons: db?.pigeons ?? [],
    batches: db?.batches ?? [],
    entries: db?.entries ?? [],
    archives: db?.archives ?? [],
    toasts,
    resetDemo,
    pushToast,
    dismissToast,
  };
}
