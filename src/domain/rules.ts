// 规则层：全部为纯函数，不读写存储、不碰 React。
// 任何“状态/排行/统计”结论都在这里从原始事实推导，保证列表、统计、
// 单羽档案读取的是同一份规则，刷新后必然一致；放飞参数一改，结论自动重算。

import type {
  Batch,
  BatchStats,
  Entry,
  EntryStatus,
  EntryView,
  FlagCode,
  Pigeon,
  RankRow,
} from "./types";

/** 合理速度区间（米/分）。参考赛鸽常见分速，越界只留待复核 */
export const MIN_SPEED_MPM = 400;
export const MAX_SPEED_MPM = 1700;

/** 鸽主与传感器报时差异超过该秒数即视为不一致，需另一人复核 */
export const TIME_TOLERANCE_SEC = 60;

export const STATUS_TEXT: Record<EntryStatus, string> = {
  "pending-time": "未归巢",
  review: "待复核",
  valid: "已核验",
  void: "复核无效",
};

export const FLAG_TEXT: Record<FlagCode, string> = {
  "missing-times": "归巢报时不全",
  "time-conflict": "鸽主/传感器报时不一致",
  early: "归巢早于放飞",
  "no-distance": "缺航距",
  "speed-out": "速度越界",
};

/** 距离分级（原训放页的筛选口径） */
export function distanceBand(distanceM: number | null): string {
  if (distanceM == null) return "未设航距";
  if (distanceM < 100_000) return "短距离";
  if (distanceM <= 300_000) return "中距离";
  return "长距离";
}

/**
 * 核验一羽上笼记录。
 *
 * 规则：
 * 1. 没有任何归巢报时 → 未归巢（pending-time）。
 * 2. 复核人已裁决：作废 → void；接受并指定归巢时间 → 用裁决时间核验：
 *    早于放飞 / 缺航距 / 速度越界仍会被重新标出（参数可能已改动），
 *    只有全部干净才重新进入排行。
 * 3. 无人裁决时，鸽主、传感器报时须齐全；双方都有但差异超容差，保留双方
 *    原值并标记 time-conflict。
 * 4. 自动核验（双方齐全且一致）：早于放飞、缺航距、速度越界 → 只留待复核，
 *    不进排行；全部干净 → valid 进排行。
 */
export function evaluateEntry(entry: Entry, batch: Batch): EntryView {
  const hasOwner = entry.ownerTime != null;
  const hasSensor = entry.sensorTime != null;
  const releaseMs = Date.parse(batch.releaseTime);

  let discrepancyMin: number | null = null;
  if (hasOwner && hasSensor) {
    discrepancyMin =
      Math.abs(Date.parse(entry.ownerTime!) - Date.parse(entry.sensorTime!)) /
      60000;
  }

  // 1. 未报时
  if (!hasOwner && !hasSensor) {
    return view(entry, "pending-time", [], null, null, null);
  }

  // 2. 人工裁决
  if (entry.verdict === "void") {
    return view(entry, "void", [], null, null, discrepancyMin);
  }
  if (entry.verdict === "accepted") {
    if (entry.adjudicatedTime == null) {
      return view(entry, "review", ["missing-times"], null, null, discrepancyMin);
    }
    const flags = structuralFlags(entry.adjudicatedTime, batch, releaseMs);
    return view(
      entry,
      flags.length === 0 ? "valid" : "review",
      flags,
      flags.length === 0 ? entry.adjudicatedTime : null,
      flags.length === 0
        ? speed(batch.distanceM, releaseMs, entry.adjudicatedTime)
        : null,
      discrepancyMin
    );
  }

  // 3. 报时不全：只保留已报的原值，等另一人复核
  if (!hasOwner || !hasSensor) {
    return view(entry, "review", ["missing-times"], null, null, discrepancyMin);
  }

  // 报时不一致：双方原值都保留，不替用户取舍
  if (discrepancyMin != null && discrepancyMin * 60 > TIME_TOLERANCE_SEC) {
    return view(
      entry,
      "review",
      ["time-conflict"],
      null,
      null,
      discrepancyMin
    );
  }

  // 4. 自动核验：以传感器时间为准（双方一致时等价）
  const arrival = entry.sensorTime!;
  const flags = structuralFlags(arrival, batch, releaseMs);
  if (flags.length > 0) {
    return view(entry, "review", flags, null, null, discrepancyMin);
  }
  return view(
    entry,
    "valid",
    [],
    arrival,
    speed(batch.distanceM, releaseMs, arrival),
    discrepancyMin
  );
}

/** 结构类问题：早于放飞 / 缺航距 / 速度越界（航距与时间参数变动后会重新判定） */
function structuralFlags(
  arrivalTime: string,
  batch: Batch,
  releaseMs: number
): FlagCode[] {
  const flags: FlagCode[] = [];
  const arrivalMs = Date.parse(arrivalTime);
  if (!Number.isFinite(arrivalMs) || !Number.isFinite(releaseMs)) {
    flags.push("missing-times");
    return flags;
  }
  if (arrivalMs < releaseMs) {
    flags.push("early");
    return flags; // 早于放飞时算速度没有意义
  }
  if (batch.distanceM == null) {
    flags.push("no-distance");
    return flags;
  }
  const v = speed(batch.distanceM, releaseMs, arrivalTime);
  if (v == null || v < MIN_SPEED_MPM || v > MAX_SPEED_MPM) {
    flags.push("speed-out");
  }
  return flags;
}

function speed(
  distanceM: number | null,
  releaseMs: number,
  arrivalTime: string
): number | null {
  if (distanceM == null) return null;
  const mins = (Date.parse(arrivalTime) - releaseMs) / 60000;
  if (mins <= 0) return null;
  return distanceM / mins;
}

function view(
  entry: Entry,
  status: EntryStatus,
  flags: FlagCode[],
  arrivalTime: string | null,
  speedMpm: number | null,
  discrepancyMin: number | null
): EntryView {
  return { entry, ring: entry.ring, status, flags, arrivalTime, speedMpm, discrepancyMin };
}

/** 批量核验（列表/统计/排行共用的唯一入口） */
export function evaluateBatch(
  entries: Entry[],
  batch: Batch
): Map<string, EntryView> {
  const map = new Map<string, EntryView>();
  for (const e of entries) {
    if (e.batchId === batch.id) map.set(e.id, evaluateEntry(e, batch));
  }
  return map;
}

/** 排行：仅核验通过者，按分速降序，同分按足环号 */
export function ranking(
  entries: Entry[],
  batch: Batch
): RankRow[] {
  return entries
    .filter((e) => e.batchId === batch.id)
    .map((e) => evaluateEntry(e, batch))
    .filter((v): v is EntryView & { speedMpm: number; arrivalTime: string } =>
      v.status === "valid" && v.speedMpm != null && v.arrivalTime != null
    )
    .sort((a, b) => b.speedMpm - a.speedMpm || a.ring.localeCompare(b.ring))
    .map((v, i) => ({ ...v, rank: i + 1 }));
}

/** 未归巢：已上笼但没有任何一路归巢报时（报了但异常的不算未归巢，属待复核） */
export function notReturned(entries: Entry[], batch: Batch): EntryView[] {
  return entries
    .filter((e) => e.batchId === batch.id)
    .map((e) => evaluateEntry(e, batch))
    .filter((v) => v.status === "pending-time");
}

export function batchStats(entries: Entry[], batch: Batch): BatchStats {
  const views = entries
    .filter((e) => e.batchId === batch.id)
    .map((e) => evaluateEntry(e, batch));
  const registered = views.length;
  const valid = views.filter((v) => v.status === "valid").length;
  const review = views.filter((v) => v.status === "review").length;
  const voidCount = views.filter((v) => v.status === "void").length;
  const missing = views.filter((v) => v.status === "pending-time").length;
  const speeds = views
    .map((v) => v.speedMpm)
    .filter((s): s is number => s != null);
  return {
    registered,
    valid,
    review,
    voidCount,
    notReturned: missing,
    returnRate:
      registered === 0
        ? null
        : Math.round(((registered - missing) / registered) * 1000) / 10,
    avgSpeed:
      speeds.length === 0
        ? null
        : Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length),
  };
}

/** 鸽棚总览统计（跨全部批次，上笼羽数去重） */
export interface LoftStats {
  pigeonCount: number;
  batchCount: number;
  openBatchCount: number;
  entriesTotal: number;
  validTotal: number;
  reviewTotal: number;
  notReturnedTotal: number;
  avgSpeed: number | null;
  bloodlines: Array<{ name: string; count: number }>;
}

export function loftStats(
  pigeons: Pigeon[],
  batches: Batch[],
  entries: Entry[]
): LoftStats {
  let validTotal = 0;
  let reviewTotal = 0;
  let notReturnedTotal = 0;
  const speeds: number[] = [];
  for (const batch of batches) {
    for (const v of evaluateBatch(entries, batch).values()) {
      if (v.status === "valid") {
        validTotal += 1;
        if (v.speedMpm != null) speeds.push(v.speedMpm);
      } else if (v.status === "review") reviewTotal += 1;
      else if (v.status === "pending-time") notReturnedTotal += 1;
    }
  }
  const bloodlineCount = new Map<string, number>();
  for (const p of pigeons) {
    bloodlineCount.set(p.bloodline, (bloodlineCount.get(p.bloodline) ?? 0) + 1);
  }
  return {
    pigeonCount: pigeons.length,
    batchCount: batches.length,
    openBatchCount: batches.filter((b) => b.status === "open").length,
    entriesTotal: entries.length,
    validTotal,
    reviewTotal,
    notReturnedTotal,
    avgSpeed:
      speeds.length === 0
        ? null
        : Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length),
    bloodlines: [...bloodlineCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}
