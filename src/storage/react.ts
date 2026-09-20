import { useSyncExternalStore } from "react";
import { AppData } from "../domain/types";
import { store } from "./store";

/** 所有视图共用同一份仓储快照，写入后列表/统计/档案一起刷新 */
export function useAppData(): AppData {
  return useSyncExternalStore(store.subscribe, () => store.getState());
}
