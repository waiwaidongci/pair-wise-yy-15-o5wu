import { store } from "../storage/store";

/** 视图层统一入参：同一份仓储快照 + 当前操作人 */
export interface ConsoleProps {
  data: ReturnType<typeof store.getState>;
  operatorId: string;
}
