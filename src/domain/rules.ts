// 规则层：全部为纯函数。
// 决定单羽状态、排行、统计与参数改动前的旧结论快照；
// 不读写存储、不依赖 React，任何视图与仓储都只能经这些函数读取结论。

import {
  AppData,
  BatchEvaluation,
  BatchSnapshot,
  BatchSnapshotParams,
  Entry,
  EntryState,
  EvaluatedEntry,
  Pigeon,
  RankedEntry,
  ReleaseBatch,
} from "./types";

/** 合法分速区间（米/分），超出即留待复核，不进排行 */
export const MIN_SPEED_MPM = 400;
export const MAX_SPEED_MPM = 1800;

/** 鸽主与传感器报时差在该容忍秒数内视为一致 */
export const REPORT_TOLERANCE_SEC = 60;

export function toTime(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export function formatMpm(speed: number | null): string {
  if (speed === null) return "—";
  return `${speed.toFixed(1)} m/min`;
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}时${String(m).padStart(2, "0")}分${String(r).padStart(2, "0")}秒`;
}

export const STATE_LABEL: Record<EntryState, string> = {
  ranked: "排行中",
  held: "待复核",
  disputed: "报时争议",
  noreturn: "未归巢",
  void: "已作废",
};

/** 单羽核验：所有判定都由放飞参数与双方原始报时即时推导 */
export function evaluateEntry(entry: Entry, batch: ReleaseBatch): EvaluatedEntry {
  const flags: string[] = [];
  const notes: string[] = [];

  if (entry.review?.decision === "void") {
    return {
      entry,
      state: "void",
      officialReportedAt: null,
      durationSec: null,
      speedMpm: null,
      flags: ["复核作废"],
      notes: [],
    };
  }

  const ownerRaw = toTime(entry.ownerReportedAt);
  const sensorRaw = toTime(entry.sensorReportedAt);
  const releasedRaw = toTime(batch.releasedAt);

  // 确定采信时间：复核裁定优先，其次传感器，其次鸽主
  let officialRaw: number | null = null;
  let officialSource: "review" | "sensor" | "owner" | null = null;

  if (entry.review && entry.review.decision === "owner") {
    officialRaw = ownerRaw;
    officialSource = "review";
  } else if (entry.review && entry.review.decision === "sensor") {
    officialRaw = sensorRaw;
    officialSource = "review";
  } else if (sensorRaw !== null) {
    officialRaw = sensorRaw;
    officialSource = "sensor";
  } else if (ownerRaw !== null) {
    officialRaw = ownerRaw;
    officialSource = "owner";
  }

  // 双方都有报时但不一致：保留双方原值，挂争议，等另一人复核
  const disputed =
    !entry.review &&
    ownerRaw !== null &&
    sensorRaw !== null &&
    Math.abs(ownerRaw - sensorRaw) > REPORT_TOLERANCE_SEC * 1000;

  if (disputed) flags.push("鸽主与传感器报时不一致，须另一人复核");
  // 争议未裁前没有官方采信时间，双方原值只展示、不参与计时
  if (disputed) {
    officialRaw = null;
    officialSource = null;
  }
  if (ownerRaw !== null && sensorRaw === null) notes.push("仅鸽主报时");
  if (sensorRaw !== null && ownerRaw === null) notes.push("仅传感器报时");
  if (officialSource === "review") notes.push("已由复核人裁定采信方");

  const hasAnyReport = ownerRaw !== null || sensorRaw !== null;
  const hasReport = officialRaw !== null; // 采信时间（争议未裁时为 null）
  const hasRelease = releasedRaw !== null;
  const hasDistance = typeof batch.distanceMeters === "number" && batch.distanceMeters > 0;

  if (!hasAnyReport) flags.push("归巢报时缺失");
  if (!hasRelease) flags.push("放飞时间缺失");
  if (!hasDistance) flags.push("放飞航距缺失");

  let durationSec: number | null = null;
  let speedMpm: number | null = null;
  let early = false;

  if (officialRaw !== null && hasRelease) {
    durationSec = (officialRaw - releasedRaw) / 1000;
    if (durationSec < 0) {
      early = true;
      flags.push("归巢时间早于放飞时间");
    }
  }

  if (hasReport && hasRelease && hasDistance && !early && !disputed) {
    speedMpm = (batch.distanceMeters as number) / ((durationSec as number) / 60);
    if (speedMpm < MIN_SPEED_MPM || speedMpm > MAX_SPEED_MPM) {
      flags.push(`分速越界（${speedMpm.toFixed(1)} m/min，允许 ${MIN_SPEED_MPM}–${MAX_SPEED_MPM}）`);
    }
  }

  let state: EntryState;
  if (!hasAnyReport) state = "noreturn";
  else if (disputed) state = "disputed";
  else if (early || !hasRelease || !hasDistance || speedMpm === null || speedMpm < MIN_SPEED_MPM || speedMpm > MAX_SPEED_MPM) {
    state = "held";
  } else {
    state = "ranked";
  }

  return {
    entry,
    state,
    officialReportedAt: officialRaw === null ? null : new Date(officialRaw).toISOString(),
    durationSec,
    speedMpm: state === "ranked" ? speedMpm : null,
    flags,
    notes,
  };
}

function rank(entries: EvaluatedEntry[]): RankedEntry[] {
  return [...entries]
    .filter((e) => e.state === "ranked" && e.speedMpm !== null)
    .sort(
      (a, b) =>
        (b.speedMpm as number) - (a.speedMpm as number) ||
        ((a.durationSec as number) - (b.durationSec as number)) ||
        a.entry.ringNo.localeCompare(b.entry.ringNo, "zh"),
    )
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/** 批次核验结论：列表、排行、统计的唯一数据来源 */
export function evaluateBatch(
  batch: ReleaseBatch,
  entries: Entry[],
): BatchEvaluation {
  const all = entries
    .filter((e) => e.batchId === batch.id)
    .map((e) => evaluateEntry(e, batch));

  const ranked = rank(all);
  const held = all.filter((e) => e.state === "held");
  const disputed = all.filter((e) => e.state === "disputed");
  const noreturn = all.filter((e) => e.state === "noreturn");
  const voided = all.filter((e) => e.state === "void");

  const accounted = all.filter((e) => e.state !== "void");
  const returned = accounted.filter((e) => e.state !== "noreturn").length;
  const returnRate = accounted.length ? returned / accounted.length : null;
  const speeds = ranked.map((e) => e.speedMpm as number);
  const avgSpeedMpm = speeds.length
    ? speeds.reduce((sum, v) => sum + v, 0) / speeds.length
    : null;

  return { ranked, held, disputed, noreturn, voided, all, returnRate, avgSpeedMpm };
}

/** 未归巢提醒：仅在未结束批次中出现 */
export function openBatches(data: AppData): ReleaseBatch[] {
  return data.batches.filter((b) => b.status === "open");
}

/** 参数改动前归档的旧结论（排行与统计冻结在旧值上） */
export function buildSnapshot(
  batch: ReleaseBatch,
  entries: Entry[],
  changedAt: string,
  changedBy: string,
  reason: string,
): BatchSnapshot {
  const evaluation = evaluateBatch(batch, entries);
  const params: BatchSnapshotParams = {
    site: batch.site,
    distanceMeters: batch.distanceMeters,
    releasedAt: batch.releasedAt,
    weather: batch.weather,
  };
  return {
    changedAt,
    changedBy,
    reason,
    params,
    ranked: evaluation.ranked.map((r) => ({
      rank: r.rank,
      ringNo: r.entry.ringNo,
      durationSec: r.durationSec as number,
      speedMpm: r.speedMpm as number,
    })),
    heldCount: evaluation.held.length,
    disputedCount: evaluation.disputed.length,
    noreturnCount: evaluation.noreturn.length,
  };
}

export interface PigeonHistoryRow {
  batchId: string;
  batchCode: string;
  batchStatus: ReleaseBatch["status"];
  evaluated: EvaluatedEntry;
}

export interface PigeonProfile {
  pigeon: Pigeon;
  history: PigeonHistoryRow[];
  rankedCount: number;
  bestSpeedMpm: number | null;
}

/** 单羽档案：跨批次收集，状态由最新规则即时推导，刷新后与列表一致 */
export function buildPigeonProfile(
  ringNo: string,
  data: AppData,
): PigeonProfile | null {
  const pigeon = data.pigeons.find((p) => p.ringNo === ringNo) ?? null;
  if (!pigeon) return null;
  const history: PigeonHistoryRow[] = [];
  const releasedAtByBatch = new Map<string, string>();
  for (const batch of data.batches) {
    releasedAtByBatch.set(batch.id, batch.releasedAt);
    for (const entry of data.entries.filter(
      (e) => e.batchId === batch.id && e.ringNo === ringNo,
    )) {
      history.push({
        batchId: batch.id,
        batchCode: batch.code,
        batchStatus: batch.status,
        evaluated: evaluateEntry(entry, batch),
      });
    }
  }
  history.sort((a, b) =>
    (releasedAtByBatch.get(b.batchId) ?? "").localeCompare(
      releasedAtByBatch.get(a.batchId) ?? "",
    ),
  );
  const speeds = history
    .map((h) => h.evaluated.speedMpm)
    .filter((v): v is number => v !== null);
  return {
    pigeon,
    history,
    rankedCount: history.filter((h) => h.evaluated.state === "ranked").length,
    bestSpeedMpm: speeds.length ? Math.max(...speeds) : null,
  };
}

export interface OverviewStats {
  pigeonCount: number;
  bloodlineCount: number;
  openBatchCount: number;
  closedBatchCount: number;
  entryCount: number;
  rankedCount: number;
  heldCount: number;
  disputedCount: number;
  noreturnCount: number;
  returnRate: number | null;
  avgSpeedMpm: number | null;
}

/** 鸽棚总览：与批次列表、单羽档案共用同一套规则函数 */
export function buildOverview(data: AppData): OverviewStats {
  let ranked = 0;
  let held = 0;
  let disputed = 0;
  let noreturn = 0;
  let accounted = 0;
  let returned = 0;
  const speedSum: number[] = [];

  for (const batch of data.batches) {
    const evaluation = evaluateBatch(
      batch,
      data.entries.filter((e) => e.batchId === batch.id),
    );
    ranked += evaluation.ranked.length;
    held += evaluation.held.length;
    disputed += evaluation.disputed.length;
    noreturn += evaluation.noreturn.length;
    const live = evaluation.all.filter((e) => e.state !== "void");
    accounted += live.length;
    returned += live.filter((e) => e.state !== "noreturn").length;
    speedSum.push(...evaluation.ranked.map((e) => e.speedMpm as number));
  }

  return {
    pigeonCount: data.pigeons.length,
    bloodlineCount: new Set(data.pigeons.map((p) => p.bloodline)).size,
    openBatchCount: openBatches(data).length,
    closedBatchCount: data.batches.length - openBatches(data).length,
    entryCount: data.entries.length,
    rankedCount: ranked,
    heldCount: held,
    disputedCount: disputed,
    noreturnCount: noreturn,
    returnRate: accounted ? returned / accounted : null,
    avgSpeedMpm: speedSum.length
      ? speedSum.reduce((s, v) => s + v, 0) / speedSum.length
      : null,
  };
}

export function batchById(data: AppData, id: string): ReleaseBatch | undefined {
  return data.batches.find((b) => b.id === id);
}
