// 存储层：负责持久化与“提交即裁决”的入口校验。
// 不包含任何业务判断（速度、状态等）——那些全部调用 domain/rules 推导。
// 所有方法返回带 HTTP 风格状态码的结果：
//   409 冲突提交 → 拒绝且完全不落库；400 参数不全；404 资源不存在。

import { evaluateEntry } from "../domain/rules";
import type {
  Batch,
  Database,
  Entry,
  EntryStatus,
  FlagCode,
  ParamArchive,
  Pigeon,
} from "../domain/types";

const STORAGE_KEY = "pigeon-loft-verification-db-v1";
const LATENCY_MS = 120;

export type RepoResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string };

export interface DatabaseSnapshot {
  pigeons: Pigeon[];
  batches: Batch[];
  entries: Entry[];
  archives: ParamArchive[];
}

export interface ReleasePatch {
  location: string;
  releaseTime: string;
  distanceM: number | null;
  weather: string;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function success<T>(data: T, status = 200): RepoResult<T> {
  return { ok: true, status, data };
}

function failure(
  status: number,
  code: string,
  message: string
): RepoResult<never> {
  return { ok: false, status, code, message };
}

function nowIso(): string {
  return new Date().toISOString();
}

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/** 以本地时区拼装 ISO 时间，种子数据用（可带秒） */
function localIso(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  sec = 0
): string {
  const dt = new Date(y, m - 1, d, h, min, sec, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(
    dt.getDate()
  )}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// 种子数据：一个已结束的 60km 批次 + 今日未结束的 80km 批次，覆盖各种核验情形
// ---------------------------------------------------------------------------

function seed(): Database {
  const pigeons: Pigeon[] = [
    { ring: "CHN-24-001839", bloodline: "詹森系", health: "健康正常", mateRing: "CHN-23-008771", createdAt: nowIso() },
    { ring: "CHN-24-002114", bloodline: "凡龙系", health: "观察中", mateRing: "", createdAt: nowIso() },
    { ring: "CHN-23-008771", bloodline: "种鸽", health: "健康正常", mateRing: "CHN-24-001839", createdAt: nowIso() },
    { ring: "CHN-24-003502", bloodline: "胡本系", health: "健康正常", mateRing: "", createdAt: nowIso() },
    { ring: "CHN-24-004218", bloodline: "盖比系", health: "健康正常", mateRing: "", createdAt: nowIso() },
    { ring: "CHN-25-001107", bloodline: "詹森系", health: "健康正常", mateRing: "", createdAt: nowIso() },
    { ring: "CHN-25-002660", bloodline: "凡龙系", health: "轻伤观察", mateRing: "", createdAt: nowIso() },
    { ring: "CHN-25-003992", bloodline: "电脑系", health: "健康正常", mateRing: "", createdAt: nowIso() },
  ];

  const batches: Batch[] = [
    {
      id: "batch-b1",
      name: "秋季首训 · 60km",
      location: "南郊训放点",
      releaseTime: localIso(2026, 9, 13, 7, 30),
      distanceM: 60000,
      weather: "晴",
      status: "closed",
      createdAt: localIso(2026, 9, 13, 6, 0),
      closedAt: localIso(2026, 9, 13, 12, 0),
    },
    {
      id: "batch-b2",
      name: "今日训放 · 80km",
      location: "北河开笼点",
      releaseTime: localIso(2026, 9, 20, 7, 30),
      distanceM: 80000,
      weather: "多云",
      status: "open",
      createdAt: localIso(2026, 9, 20, 6, 10),
      closedAt: null,
    },
  ];

  const entries: Entry[] = [
    // 已结束批次：两路报时一致 → 自动核验通过
    {
      id: "entry-b1-1839", batchId: "batch-b1", ring: "CHN-24-001839",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 13, 6, 20),
      ownerTime: localIso(2026, 9, 13, 8, 21), sensorTime: localIso(2026, 9, 13, 8, 20, 55),
      reporter: "鸽主老陈", reportedAt: localIso(2026, 9, 13, 8, 25),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 报时不一致 → 已由第三方复核接受，采用复核时间
    {
      id: "entry-b1-3502", batchId: "batch-b1", ring: "CHN-24-003502",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 13, 6, 20),
      ownerTime: localIso(2026, 9, 13, 8, 30), sensorTime: localIso(2026, 9, 13, 8, 28),
      reporter: "助手小王", reportedAt: localIso(2026, 9, 13, 8, 33),
      verdict: "accepted", adjudicatedTime: localIso(2026, 9, 13, 8, 29),
      reviewer: "李教练", reviewedAt: localIso(2026, 9, 13, 9, 10),
      reviewNote: "以鸽钟与传感器均值附近取整，确认 08:29 归巢",
    },
    {
      id: "entry-b1-4218", batchId: "batch-b1", ring: "CHN-24-004218",
      registrar: "助手小王", registeredAt: localIso(2026, 9, 13, 6, 25),
      ownerTime: localIso(2026, 9, 13, 8, 25, 30), sensorTime: localIso(2026, 9, 13, 8, 25, 40),
      reporter: "助手小王", reportedAt: localIso(2026, 9, 13, 8, 30),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 延迟未归（已结束批次中保留未归巢状态）
    {
      id: "entry-b1-2114", batchId: "batch-b1", ring: "CHN-24-002114",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 13, 6, 20),
      ownerTime: null, sensorTime: null, reporter: null, reportedAt: null,
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },

    // 今日未结束批次：核验通过
    {
      id: "entry-b2-1839", batchId: "batch-b2", ring: "CHN-24-001839",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 20, 6, 40),
      ownerTime: localIso(2026, 9, 20, 8, 37, 40), sensorTime: localIso(2026, 9, 20, 8, 37, 50),
      reporter: "鸽主老陈", reportedAt: localIso(2026, 9, 20, 8, 40),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 核验通过（高分数）
    {
      id: "entry-b2-1107", batchId: "batch-b2", ring: "CHN-25-001107",
      registrar: "助手小王", registeredAt: localIso(2026, 9, 20, 6, 42),
      ownerTime: localIso(2026, 9, 20, 8, 32), sensorTime: localIso(2026, 9, 20, 8, 32, 5),
      reporter: "助手小王", reportedAt: localIso(2026, 9, 20, 8, 35),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 鸽主/传感器报时不一致 → 待复核，双方原值保留
    {
      id: "entry-b2-3502", batchId: "batch-b2", ring: "CHN-24-003502",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 20, 6, 40),
      ownerTime: localIso(2026, 9, 20, 8, 45), sensorTime: localIso(2026, 9, 20, 8, 50, 30),
      reporter: "助手小王", reportedAt: localIso(2026, 9, 20, 8, 53),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 只有鸽主报时 → 报时不全，待复核
    {
      id: "entry-b2-4218", batchId: "batch-b2", ring: "CHN-24-004218",
      registrar: "助手小王", registeredAt: localIso(2026, 9, 20, 6, 42),
      ownerTime: localIso(2026, 9, 20, 8, 34), sensorTime: null,
      reporter: "鸽主老陈", reportedAt: localIso(2026, 9, 20, 8, 36),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 归巢早于放飞 → 待复核
    {
      id: "entry-b2-2660", batchId: "batch-b2", ring: "CHN-25-002660",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 20, 6, 40),
      ownerTime: localIso(2026, 9, 20, 7, 20), sensorTime: localIso(2026, 9, 20, 7, 20, 10),
      reporter: "助手小王", reportedAt: localIso(2026, 9, 20, 7, 25),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 飞行时间过长，速度越界（<400 m/min）→ 待复核
    {
      id: "entry-b2-3992", batchId: "batch-b2", ring: "CHN-25-003992",
      registrar: "助手小王", registeredAt: localIso(2026, 9, 20, 6, 42),
      ownerTime: localIso(2026, 9, 20, 11, 10), sensorTime: localIso(2026, 9, 20, 11, 10, 5),
      reporter: "助手小王", reportedAt: localIso(2026, 9, 20, 11, 15),
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
    // 尚未报时 → 未归巢提醒
    {
      id: "entry-b2-2114", batchId: "batch-b2", ring: "CHN-24-002114",
      registrar: "鸽主老陈", registeredAt: localIso(2026, 9, 20, 6, 40),
      ownerTime: null, sensorTime: null, reporter: null, reportedAt: null,
      verdict: null, adjudicatedTime: null, reviewer: null, reviewedAt: null, reviewNote: null,
    },
  ];

  return { version: 1, pigeons, batches, entries, archives: [] };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class PigeonRepository {
  private db: Database;

  constructor() {
    this.db = this.load();
  }

  private load(): Database {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Database;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
          return parsed;
        }
      }
    } catch {
      // 存储损坏时回落到种子数据
    }
    const fresh = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // 隐私模式等场景下仅内存可用
    }
    return fresh;
  }

  /** 每次成功落库后广播；409/400 等拒绝路径不调用 persist，也就不会触发刷新 */
  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db));
    } catch {
      // 忽略写入失败，内存数据仍可供本会话使用
    }
    try {
      window.dispatchEvent(new Event("loft:changed"));
    } catch {
      // 非浏览器环境忽略
    }
  }

  /** 重置为种子数据（页面上提供“重置演示数据”入口） */
  async reset(): Promise<RepoResult<DatabaseSnapshot>> {
    await delay();
    this.db = seed();
    this.persist();
    return success(this.snapshot());
  }

  private snapshot(): DatabaseSnapshot {
    return {
      pigeons: clone(this.db.pigeons),
      batches: clone(this.db.batches),
      entries: clone(this.db.entries),
      archives: clone(this.db.archives),
    };
  }

  async list(): Promise<DatabaseSnapshot> {
    await delay();
    return this.snapshot();
  }

  // ----- 鸽主档案 ----------------------------------------------------------

  async createPigeon(input: {
    ring: string;
    bloodline: string;
    health: string;
    mateRing?: string;
  }): Promise<RepoResult<Pigeon>> {
    await delay();
    const ring = input.ring.trim();
    if (!ring) return failure(400, "ring-required", "足环号不能为空");
    if (this.db.pigeons.some((p) => p.ring === ring)) {
      // 冲突提交：直接拒绝，不落库
      return failure(409, "pigeon-exists", `足环号 ${ring} 已存在档案`);
    }
    const pigeon: Pigeon = {
      ring,
      bloodline: input.bloodline.trim() || "未登记血统",
      health: input.health.trim() || "健康正常",
      mateRing: input.mateRing?.trim() ?? "",
      createdAt: nowIso(),
    };
    this.db.pigeons.push(pigeon);
    this.persist();
    return success(clone(pigeon), 201);
  }

  async updatePigeon(
    ring: string,
    patch: Partial<Pick<Pigeon, "bloodline" | "health" | "mateRing">>
  ): Promise<RepoResult<Pigeon>> {
    await delay();
    const pigeon = this.db.pigeons.find((p) => p.ring === ring);
    if (!pigeon) return failure(404, "pigeon-missing", "没有这羽赛鸽的档案");
    if (patch.bloodline !== undefined) pigeon.bloodline = patch.bloodline.trim() || pigeon.bloodline;
    if (patch.health !== undefined) pigeon.health = patch.health.trim() || pigeon.health;
    if (patch.mateRing !== undefined) pigeon.mateRing = patch.mateRing.trim();
    this.persist();
    return success(clone(pigeon));
  }

  // ----- 批次 --------------------------------------------------------------

  async createBatch(input: {
    name?: string;
    location: string;
    releaseTime: string;
    distanceM: number | null;
    weather?: string;
  }): Promise<RepoResult<Batch>> {
    await delay();
    const location = input.location.trim();
    if (!location) return failure(400, "location-required", "训放地点（放飞参数）不能为空");
    if (!input.releaseTime || !Number.isFinite(Date.parse(input.releaseTime))) {
      return failure(400, "release-time-required", "放飞时间（放飞参数）不齐全");
    }
    if (input.distanceM != null && (!(input.distanceM > 0) || !Number.isFinite(input.distanceM))) {
      return failure(400, "distance-invalid", "航距必须为正数（米）");
    }
    const dt = new Date(input.releaseTime);
    const pad = (n: number) => String(n).padStart(2, "0");
    const name =
      input.name?.trim() ||
      `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${location}训放`;
    const batch: Batch = {
      id: newId("batch"),
      name,
      location,
      releaseTime: input.releaseTime,
      distanceM: input.distanceM,
      weather: input.weather?.trim() ?? "",
      status: "open",
      createdAt: nowIso(),
      closedAt: null,
    };
    this.db.batches.push(batch);
    this.persist();
    return success(clone(batch), 201);
  }

  async closeBatch(batchId: string): Promise<RepoResult<Batch>> {
    await delay();
    const batch = this.db.batches.find((b) => b.id === batchId);
    if (!batch) return failure(404, "batch-missing", "批次不存在");
    if (batch.status === "closed") return failure(400, "batch-closed", "批次已结束");
    batch.status = "closed";
    batch.closedAt = nowIso();
    this.persist();
    return success(clone(batch));
  }

  /**
   * 改动放飞参数：先把“按旧参数推出的结论”逐羽留档，再写入新参数。
   * 排行/提醒/速度全部是规则层实时推导，落库后所有视图自动按新值重算。
   */
  async updateReleaseParams(
    batchId: string,
    editor: string,
    patch: ReleasePatch
  ): Promise<RepoResult<{ batch: Batch; archive: ParamArchive }>> {
    await delay();
    const who = editor.trim();
    if (!who) return failure(400, "editor-required", "请填写操作人以便留档");
    const batch = this.db.batches.find((b) => b.id === batchId);
    if (!batch) return failure(404, "batch-missing", "批次不存在");
    if (!patch.location.trim()) {
      return failure(400, "location-required", "训放地点不能为空");
    }
    if (!patch.releaseTime || !Number.isFinite(Date.parse(patch.releaseTime))) {
      return failure(400, "release-time-required", "放飞时间不齐全");
    }
    if (
      patch.distanceM != null &&
      (!(patch.distanceM > 0) || !Number.isFinite(patch.distanceM))
    ) {
      return failure(400, "distance-invalid", "航距必须为正数（米），或留空待补录");
    }

    const oldConclusions = this.db.entries
      .filter((e) => e.batchId === batch.id)
      .map((e) => {
        const v = evaluateEntry(e, batch);
        return {
          entryId: e.id,
          ring: e.ring,
          status: v.status as EntryStatus,
          speedMpm: v.speedMpm as number | null,
          flags: [...v.flags] as FlagCode[],
        };
      });

    const archive: ParamArchive = {
      id: newId("archive"),
      batchId: batch.id,
      editor: who,
      changedAt: nowIso(),
      before: {
        releaseTime: batch.releaseTime,
        distanceM: batch.distanceM,
        location: batch.location,
        weather: batch.weather,
      },
      after: {
        releaseTime: patch.releaseTime,
        distanceM: patch.distanceM,
        location: patch.location.trim(),
        weather: patch.weather.trim(),
      },
      conclusions: oldConclusions,
    };

    batch.location = patch.location.trim();
    batch.releaseTime = patch.releaseTime;
    batch.distanceM = patch.distanceM;
    batch.weather = patch.weather.trim();
    this.db.archives.unshift(archive);
    this.persist();
    return success({ batch: clone(batch), archive: clone(archive) });
  }

  // ----- 上笼登记 ----------------------------------------------------------

  async register(
    batchId: string,
    ring: string,
    registrar: string
  ): Promise<RepoResult<Entry>> {
    await delay();
    const who = registrar.trim();
    const r = ring.trim();
    if (!r) return failure(400, "ring-required", "足环号不能为空");
    if (!who) return failure(400, "registrar-required", "请填写登记人");
    const batch = this.db.batches.find((b) => b.id === batchId);
    if (!batch) return failure(404, "batch-missing", "批次不存在");
    if (batch.status !== "open") {
      return failure(400, "batch-closed", "批次已结束，不能再上笼登记");
    }
    if (!this.db.pigeons.some((p) => p.ring === r)) {
      return failure(404, "pigeon-missing", `足环号 ${r} 尚未建档，请先在鸽棚总览建档`);
    }
    // 核心约束：同一未结束批次中每羽只能出现一次 → 冲突 409 且不落库
    if (this.db.entries.some((e) => e.batchId === batchId && e.ring === r)) {
      return failure(
        409,
        "already-registered",
        `${r} 已在本批次上笼，同一未结束批次不能重复登记`
      );
    }
    const entry: Entry = {
      id: newId("entry"),
      batchId,
      ring: r,
      registrar: who,
      registeredAt: nowIso(),
      ownerTime: null,
      sensorTime: null,
      reporter: null,
      reportedAt: null,
      verdict: null,
      adjudicatedTime: null,
      reviewer: null,
      reviewedAt: null,
      reviewNote: null,
    };
    this.db.entries.push(entry);
    this.persist();
    return success(clone(entry), 201);
  }

  // ----- 归巢报时 ----------------------------------------------------------

  async report(
    batchId: string,
    ring: string,
    reporter: string,
    times: { ownerTime: string | null; sensorTime: string | null }
  ): Promise<RepoResult<Entry>> {
    await delay();
    const who = reporter.trim();
    if (!who) return failure(400, "reporter-required", "请填写报时人");
    const ownerTime = normalizeTime(times.ownerTime);
    const sensorTime = normalizeTime(times.sensorTime);
    if (!ownerTime && !sensorTime) {
      // 归巢报时须齐全：两路都没填直接拒绝（只填一路会落库为“待复核”）
      return failure(400, "times-required", "请至少填写一路归巢报时（鸽主或传感器）");
    }
    if (
      (ownerTime && !Number.isFinite(Date.parse(ownerTime))) ||
      (sensorTime && !Number.isFinite(Date.parse(sensorTime)))
    ) {
      return failure(400, "time-invalid", "归巢时间格式无法识别");
    }
    const batch = this.db.batches.find((b) => b.id === batchId);
    if (!batch) return failure(404, "batch-missing", "批次不存在");
    if (batch.status !== "open") {
      return failure(400, "batch-closed", "批次已结束，不能再提交归巢报时");
    }
    const entry = this.db.entries.find(
      (e) => e.batchId === batchId && e.ring === ring.trim()
    );
    if (!entry) {
      return failure(404, "not-registered", `${ring} 未在本批次上笼，请先登记`);
    }
    // 已经有任何一路报时 → 冲突，拒绝重复提交，原值原样保留且不落库
    if (entry.ownerTime != null || entry.sensorTime != null) {
      return failure(
        409,
        "already-reported",
        `${ring} 在本批次已有归巢报时；如有异议请在复核队列处理`
      );
    }
    entry.ownerTime = ownerTime;
    entry.sensorTime = sensorTime;
    entry.reporter = who;
    entry.reportedAt = nowIso();
    this.persist();
    return success(clone(entry), 201);
  }

  // ----- 复核（必须由另一人处理） -------------------------------------------

  async review(
    entryId: string,
    reviewer: string,
    decision: { action: "accept"; adjudicatedTime: string; note?: string } | { action: "void"; note?: string }
  ): Promise<RepoResult<Entry>> {
    await delay();
    const who = reviewer.trim();
    if (!who) return failure(400, "reviewer-required", "请填写复核人");
    const entry = this.db.entries.find((e) => e.id === entryId);
    if (!entry) return failure(404, "entry-missing", "上笼记录不存在");
    // 报时/登记当事人不能复核自己的提交
    const parties = [entry.registrar, entry.reporter].filter(Boolean);
    if (parties.includes(who)) {
      return failure(
        409,
        "reviewer-conflict",
        "复核人必须是登记人/报时人之外的另一人"
      );
    }
    if (decision.action === "void") {
      entry.verdict = "void";
      entry.adjudicatedTime = null;
      entry.reviewer = who;
      entry.reviewedAt = nowIso();
      entry.reviewNote = decision.note?.trim() || "复核确认无效，不进入排行";
    } else {
      const t = normalizeTime(decision.adjudicatedTime);
      if (!t || !Number.isFinite(Date.parse(t))) {
        return failure(400, "adjudicated-time-required", "接受复核时必须指定认定归巢时间");
      }
      entry.verdict = "accepted";
      entry.adjudicatedTime = t;
      entry.reviewer = who;
      entry.reviewedAt = nowIso();
      entry.reviewNote = decision.note?.trim() || null;
    }
    this.persist();
    return success(clone(entry));
  }
}

function normalizeTime(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t === "" ? null : t;
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

export const repository = new PigeonRepository();
