// 存储层：唯一负责持久化（localStorage）与写入校验。
// 冲突等业务错误以带 HTTP 状态码的 StoreError 抛出；
// 校验失败（含 409）一律先抛错，不发生任何写入。
// 规则判定不在本层缓存，读取结论请走 domain/rules。

import {
  AppData,
  Entry,
  Pigeon,
  ReleaseBatch,
  ReviewDecision,
} from "../domain/types";
import { buildSnapshot } from "../domain/rules";
import { buildSeedData, StoreError } from "./seed";

export { StoreError };
export { isConflict } from "./seed";

const STORAGE_KEY = "pigeon-batch-console:v1";

export interface NewBatchInput {
  code: string;
  site: string;
  distanceMeters: number | null;
  releasedAt: string;
  weather: string;
  operatorId: string;
}

export interface NewEntryInput {
  batchId: string;
  ringNo: string;
  bloodline?: string;
  health?: string;
  pairing?: string;
  ownerReportedAt: string | null;
  sensorReportedAt: string | null;
  recorderId: string;
}

export interface ReleaseParamsInput {
  site: string;
  distanceMeters: number | null;
  releasedAt: string;
  weather: string;
}

export type Listener = () => void;

function makeId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppData;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.batches)) {
        return parsed;
      }
    }
  } catch {
    // 存储损坏时回到演示数据
  }
  const seed = buildSeedData();
  persist(seed);
  return seed;
}

function persist(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 隐私模式等场景下降级为内存态，规则与页面仍可工作
  }
}

class BatchStore {
  private data: AppData;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = load();
  }

  getState(): AppData {
    return structuredClone(this.data);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: AppData): void {
    persist(next);
    this.data = next;
    this.listeners.forEach((fn) => fn());
  }

  private nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // ---- 批次 ----

  async createBatch(input: NewBatchInput): Promise<ReleaseBatch> {
    await this.nextTick();
    const code = input.code.trim();
    const site = input.site.trim();
    const releasedAt = input.releasedAt ? new Date(input.releasedAt).toISOString() : "";
    if (!code) throw new StoreError(400, "批次编号不能为空");
    if (!site) throw new StoreError(400, "训放地点（放飞参数）不能为空");
    if (!releasedAt) throw new StoreError(400, "放飞时间（放飞参数）不能为空");
    if (input.distanceMeters !== null && input.distanceMeters <= 0) {
      throw new StoreError(400, "放飞航距必须为正数");
    }

    const next = this.getState();
    if (next.batches.some((b) => b.code === code)) {
      throw new StoreError(409, `批次编号 ${code} 已存在`);
    }
    const batch: ReleaseBatch = {
      id: makeId("batch"),
      code,
      status: "open",
      site,
      distanceMeters: input.distanceMeters,
      releasedAt,
      weather: input.weather.trim(),
      ownerId: input.operatorId,
      createdAt: new Date().toISOString(),
      closedAt: null,
      archivedSnapshots: [],
    };
    next.batches.push(batch);
    this.commit(next);
    return batch;
  }

  async closeBatch(batchId: string): Promise<void> {
    await this.nextTick();
    const next = this.getState();
    const batch = next.batches.find((b) => b.id === batchId);
    if (!batch) throw new StoreError(404, "批次不存在");
    if (batch.status === "closed") throw new StoreError(400, "批次已结束");
    batch.status = "closed";
    batch.closedAt = new Date().toISOString();
    this.commit(next);
  }

  /**
   * 改动放飞参数：先按旧参数冻结一份旧结论快照（排行/待复核/未归巢统计），
   * 再落新值；之后所有排行与提醒由规则层按新值重算。
   */
  async updateReleaseParams(
    batchId: string,
    params: ReleaseParamsInput,
    operatorId: string,
    reason: string,
  ): Promise<void> {
    await this.nextTick();
    const site = params.site.trim();
    const releasedAt = params.releasedAt ? new Date(params.releasedAt).toISOString() : "";
    if (!site) throw new StoreError(400, "训放地点不能为空");
    if (!releasedAt) throw new StoreError(400, "放飞时间不能为空");
    if (params.distanceMeters !== null && params.distanceMeters <= 0) {
      throw new StoreError(400, "放飞航距必须为正数");
    }

    const next = this.getState();
    const batch = next.batches.find((b) => b.id === batchId);
    if (!batch) throw new StoreError(404, "批次不存在");

    const changed =
      batch.site !== site ||
      batch.distanceMeters !== params.distanceMeters ||
      batch.releasedAt !== releasedAt ||
      batch.weather !== params.weather.trim();
    if (!changed) throw new StoreError(400, "放飞参数没有变化");

    const batchEntries = next.entries.filter((e) => e.batchId === batch.id);
    const snapshot = buildSnapshot(
      batch,
      batchEntries,
      new Date().toISOString(),
      operatorId,
      reason.trim() || "放飞参数修订（未填原因）",
    );
    batch.archivedSnapshots.push(snapshot);
    batch.site = site;
    batch.distanceMeters = params.distanceMeters;
    batch.releasedAt = releasedAt;
    batch.weather = params.weather.trim();
    this.commit(next);
  }

  // ---- 单羽登记 ----

  /**
   * 登记一羽：同一未结束批次中同一足环号只能出现一次，
   * 冲突抛 409 且不落库（足环档案也不会写入）。
   */
  async addEntry(input: NewEntryInput): Promise<Entry> {
    await this.nextTick();
    const ringNo = input.ringNo.trim().toUpperCase();
    if (!ringNo) throw new StoreError(400, "足环号不能为空");

    const ownerAt = this.normalizeReport(input.ownerReportedAt);
    const sensorAt = this.normalizeReport(input.sensorReportedAt);

    const next = this.getState();
    const batch = next.batches.find((b) => b.id === input.batchId);
    if (!batch) throw new StoreError(404, "批次不存在");
    if (batch.status === "closed") {
      throw new StoreError(400, `批次 ${batch.code} 已结束，不能再登记`);
    }
    const duplicated = next.entries.some(
      (e) => e.batchId === input.batchId && e.ringNo === ringNo,
    );
    if (duplicated) {
      // 409：冲突提交，直接拒绝，不发生任何写入
      throw new StoreError(409, `足环号 ${ringNo} 在未结束批次 ${batch.code} 中已存在，每羽只能出现一次`);
    }

    if (!next.pigeons.some((p) => p.ringNo === ringNo)) {
      const pigeon: Pigeon = {
        ringNo,
        bloodline: (input.bloodline ?? "").trim() || "未登记血统",
        health: (input.health ?? "").trim() || "待观察",
        pairing: (input.pairing ?? "").trim() || "无配对记录",
      };
      next.pigeons.push(pigeon);
    }

    const entry: Entry = {
      id: makeId("entry"),
      batchId: input.batchId,
      ringNo,
      ownerReportedAt: ownerAt,
      sensorReportedAt: sensorAt,
      recorderId: input.recorderId,
      createdAt: new Date().toISOString(),
      review: null,
    };
    next.entries.push(entry);
    this.commit(next);
    return entry;
  }

  /**
   * 补录归巢报时：只允许写入原来为空的通道；
   * 鸽主与传感器是两条独立原值，后到的一方不覆盖先到的一方。
   */
  async saveReport(
    entryId: string,
    source: "owner" | "sensor",
    value: string,
  ): Promise<void> {
    await this.nextTick();
    const at = this.normalizeReport(value);
    if (!at) throw new StoreError(400, "归巢报时不能为空");

    const next = this.getState();
    const entry = next.entries.find((e) => e.id === entryId);
    if (!entry) throw new StoreError(404, "登记记录不存在");
    const current = source === "owner" ? entry.ownerReportedAt : entry.sensorReportedAt;
    if (current !== null) {
      throw new StoreError(409, "该通道已有原始报时，原值保留，不得覆盖");
    }
    if (source === "owner") entry.ownerReportedAt = at;
    else entry.sensorReportedAt = at;
    this.commit(next);
  }

  /** 争议裁定/作废：必须由提交人之外的另一人完成 */
  async reviewEntry(
    entryId: string,
    decision: ReviewDecision,
    reviewerId: string,
    note: string,
  ): Promise<void> {
    await this.nextTick();
    if (!reviewerId.trim()) throw new StoreError(400, "需要填写复核人");
    const next = this.getState();
    const entry = next.entries.find((e) => e.id === entryId);
    if (!entry) throw new StoreError(404, "登记记录不存在");
    if (reviewerId.trim() === entry.recorderId) {
      throw new StoreError(403, "复核人必须是提交人之外的另一人");
    }
    if (decision === "owner" && entry.ownerReportedAt === null) {
      throw new StoreError(400, "没有鸽主报时可采信");
    }
    if (decision === "sensor" && entry.sensorReportedAt === null) {
      throw new StoreError(400, "没有传感器报时可采信");
    }
    entry.review = {
      decision,
      reviewerId: reviewerId.trim(),
      reviewedAt: new Date().toISOString(),
      note: note.trim(),
    };
    this.commit(next);
  }

  async updatePigeon(
    ringNo: string,
    patch: Partial<Pick<Pigeon, "bloodline" | "health" | "pairing">>,
  ): Promise<void> {
    await this.nextTick();
    const next = this.getState();
    const pigeon = next.pigeons.find((p) => p.ringNo === ringNo);
    if (!pigeon) throw new StoreError(404, "赛鸽档案不存在");
    if (patch.bloodline !== undefined) pigeon.bloodline = patch.bloodline.trim() || pigeon.bloodline;
    if (patch.health !== undefined) pigeon.health = patch.health.trim() || pigeon.health;
    if (patch.pairing !== undefined) pigeon.pairing = patch.pairing.trim() || pigeon.pairing;
    this.commit(next);
  }

  async resetDemo(): Promise<void> {
    await this.nextTick();
    const seed = buildSeedData();
    this.commit(seed);
  }

  private normalizeReport(value: string | null): string | null {
    if (!value || !value.trim()) return null;
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) throw new StoreError(400, "报时格式无法识别");
    return new Date(t).toISOString();
  }
}

export const store = new BatchStore();
