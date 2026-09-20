// 领域类型：批次核验台
// 存储中的对象全部为“原始事实”，状态/速度/是否上榜等结论均由规则层实时推导，
// 这样修改放飞参数后，排行与未归巢提醒会自动按新值重算。

/** 上笼登记（一羽赛鸽在一个批次中的唯一事实记录） */
export interface Entry {
  id: string;
  batchId: string;
  ring: string;
  registrar: string;
  registeredAt: string;
  /** 鸽主报归巢时间（ISO，可空表示未报） */
  ownerTime: string | null;
  /** 传感器报归巢时间（ISO，可空表示未报） */
  sensorTime: string | null;
  /** 报时人（提交归巢报时的人） */
  reporter: string | null;
  reportedAt: string | null;
  /** 复核结论：null 表示尚无人工裁决 */
  verdict: "accepted" | "void" | null;
  /** 复核采用的归巢时间（ISO）；接受时必填，作废时为空 */
  adjudicatedTime: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface Batch {
  id: string;
  name: string;
  location: string;
  /** 放飞时间 ISO（必填） */
  releaseTime: string;
  /** 航距，米；可空表示待补录，此时归巢记录无法核验 */
  distanceM: number | null;
  weather: string;
  status: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
}

export interface Pigeon {
  ring: string;
  bloodline: string;
  health: string;
  mateRing: string;
  createdAt: string;
}

/** 修改放飞参数时留档的旧结论 */
export interface ParamArchive {
  id: string;
  batchId: string;
  editor: string;
  changedAt: string;
  before: {
    releaseTime: string;
    distanceM: number | null;
    location: string;
    weather: string;
  };
  after: {
    releaseTime: string;
    distanceM: number | null;
    location: string;
    weather: string;
  };
  /** 重算前的结论快照（每羽的状态、速度、标记） */
  conclusions: Array<{
    entryId: string;
    ring: string;
    status: EntryStatus;
    speedMpm: number | null;
    flags: FlagCode[];
  }>;
}

export interface Database {
  version: 1;
  pigeons: Pigeon[];
  batches: Batch[];
  entries: Entry[];
  archives: ParamArchive[];
}

/** 单羽在批次中的核验状态（由规则层推导） */
export type EntryStatus =
  | "pending-time" // 已上笼，尚无任何归巢报时（未归巢）
  | "review" // 待复核
  | "valid" // 核验通过，进入排行
  | "void"; // 复核无效，不进排行

/** 待复核原因 */
export type FlagCode =
  | "missing-times" // 放飞参数或归巢报时不齐全
  | "time-conflict" // 鸽主与传感器报时不一致（双方原值保留）
  | "early" // 归巢早于放飞
  | "no-distance" // 缺航距
  | "speed-out"; // 速度越界

export interface EntryView {
  entry: Entry;
  ring: string;
  status: EntryStatus;
  flags: FlagCode[];
  /** 用于计算速度/上榜的归巢时间（未核验通过时为 null） */
  arrivalTime: string | null;
  speedMpm: number | null;
  /** 鸽主与传感器报时差异（分钟），双方都有时才有 */
  discrepancyMin: number | null;
}

/** 排行条目 */
export interface RankRow extends EntryView {
  rank: number;
}

export interface BatchStats {
  registered: number;
  valid: number;
  review: number;
  voidCount: number;
  notReturned: number;
  returnRate: number | null; // 已结束批次的归巢率 %
  avgSpeed: number | null; // 仅核验通过者的平均速度
}
