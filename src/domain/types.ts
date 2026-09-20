// 领域模型：赛鸽训放批次核验台
// 仅描述数据形状，不含任何行为与 UI 概念。

export type BatchStatus = "open" | "closed";

/** 单羽记录经规则层判定后的状态 */
export type EntryState =
  | "ranked" // 有效，进入排行
  | "held" // 留待复核（早于放飞 / 缺航距 / 速度越界等）
  | "disputed" // 鸽主与传感器报时不一致，等待另一人复核
  | "noreturn" // 尚未归巢报时
  | "void"; // 复核作废，不参与统计与排行

export type ReviewDecision = "owner" | "sensor" | "void";

export interface Pigeon {
  ringNo: string; // 足环号（唯一）
  bloodline: string; // 血统
  health: string; // 健康状态
  pairing: string; // 配对记录
}

export interface BatchSnapshotParams {
  site: string;
  distanceMeters: number | null;
  releasedAt: string;
  weather: string;
}

export interface SnapshotRankedRow {
  rank: number;
  ringNo: string;
  durationSec: number;
  speedMpm: number;
}

/** 放飞参数改动前归档的旧结论 */
export interface BatchSnapshot {
  changedAt: string;
  changedBy: string;
  reason: string;
  params: BatchSnapshotParams;
  ranked: SnapshotRankedRow[];
  heldCount: number;
  disputedCount: number;
  noreturnCount: number;
}

export interface ReleaseBatch extends BatchSnapshotParams {
  id: string;
  code: string; // 批次编号
  status: BatchStatus;
  ownerId: string; // 建批人
  createdAt: string;
  closedAt: string | null;
  archivedSnapshots: BatchSnapshot[];
}

export interface Review {
  decision: ReviewDecision;
  reviewerId: string; // 必须不同于提交人
  reviewedAt: string;
  note: string;
}

export interface Entry {
  id: string;
  batchId: string;
  ringNo: string;
  /** 鸽主归巢报时，原始值一经录入不得覆盖 */
  ownerReportedAt: string | null;
  /** 传感器归巢报时，原始值一经录入不得覆盖 */
  sensorReportedAt: string | null;
  recorderId: string; // 提交人
  createdAt: string;
  review: Review | null;
}

export interface EvaluatedEntry {
  entry: Entry;
  state: EntryState;
  /** 经规则采信的归巢时间（争议未裁时为 null） */
  officialReportedAt: string | null;
  durationSec: number | null;
  speedMpm: number | null;
  /** 阻断进入排行的原因（待复核 / 争议） */
  flags: string[];
  /** 不阻断排行的提示信息 */
  notes: string[];
}

export interface RankedEntry extends EvaluatedEntry {
  rank: number;
}

export interface BatchEvaluation {
  ranked: RankedEntry[];
  held: EvaluatedEntry[];
  disputed: EvaluatedEntry[];
  noreturn: EvaluatedEntry[];
  voided: EvaluatedEntry[];
  all: EvaluatedEntry[];
  /** 归巢率：有归巢报时 / 未作废羽数；无羽数时为 null */
  returnRate: number | null;
  /** 排行羽数平均速度 m/min */
  avgSpeedMpm: number | null;
}

export interface AppData {
  version: 1;
  batches: ReleaseBatch[];
  entries: Entry[];
  pigeons: Pigeon[];
}
