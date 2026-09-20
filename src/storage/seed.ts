import { AppData, Entry, Pigeon, ReleaseBatch } from "../domain/types";

/** 仓储业务错误，status 对齐 HTTP 语义；页面据此区分 409 冲突等 */
export class StoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

export function isConflict(err: unknown): boolean {
  return err instanceof StoreError && err.status === 409;
}

const DAY = 24 * 60 * 60 * 1000;

function iso(d: Date): string {
  return d.toISOString();
}

export function buildSeedData(): AppData {
  const now = Date.now();
  const t = (offsetMs: number) => iso(new Date(now + offsetMs));

  const pigeons: Pigeon[] = [
    { ringNo: "CHN-24-001839", bloodline: "詹森系", health: "健康", pairing: "002114 配 001839" },
    { ringNo: "CHN-24-002114", bloodline: "凡龙系", health: "观察", pairing: "002114 配 001839" },
    { ringNo: "CHN-23-008771", bloodline: "胡本系", health: "健康", pairing: "种鸽调理中" },
    { ringNo: "CHN-24-003207", bloodline: "詹森系", health: "健康", pairing: "未配对" },
    { ringNo: "CHN-23-005518", bloodline: "盖比系", health: "健康", pairing: "未配对" },
  ];

  // 未结束批次 B-0920-02：含争议、缺航距、越界、未归巢等各类待核验情形
  const openBatch: ReleaseBatch = {
    id: "batch-open-02",
    code: "B-0920-02",
    status: "open",
    site: "东线 120km 司放点",
    distanceMeters: null, // 航距待补，整批有报时羽先留待复核
    releasedAt: t(-3 * 60 * 60 * 1000),
    weather: "侧风",
    ownerId: "owner-li",
    createdAt: t(-1 * DAY),
    closedAt: null,
    archivedSnapshots: [],
  };

  // 已结束批次 B-0919-01：放飞参数齐全，含一羽正常排行
  const closedBatch: ReleaseBatch = {
    id: "batch-closed-01",
    code: "B-0919-01",
    status: "closed",
    site: "南线 80km 司放点",
    distanceMeters: 80000,
    releasedAt: iso(new Date(now - 2 * DAY + 7 * 60 * 60 * 1000)),
    weather: "晴",
    ownerId: "owner-li",
    createdAt: iso(new Date(now - 3 * DAY)),
    closedAt: iso(new Date(now - 2 * DAY + 10 * 60 * 60 * 1000)),
    archivedSnapshots: [],
  };

  const release02 = new Date(openBatch.releasedAt).getTime();
  const release01 = new Date(closedBatch.releasedAt).getTime();

  const entries: Entry[] = [
    // 已结束批次：正常排行
    {
      id: "e-01",
      batchId: closedBatch.id,
      ringNo: "CHN-24-001839",
      ownerReportedAt: new Date(release01 + 3900 * 1000).toISOString(), // 65 分 → 1230.8 m/min
      sensorReportedAt: new Date(release01 + 3900 * 1000 + 12 * 1000).toISOString(),
      recorderId: "owner-li",
      createdAt: closedBatch.createdAt,
      review: null,
    },
    {
      id: "e-02",
      batchId: closedBatch.id,
      ringNo: "CHN-24-003207",
      ownerReportedAt: new Date(release01 + 4700 * 1000).toISOString(),
      sensorReportedAt: new Date(release01 + 4700 * 1000 + 5 * 1000).toISOString(),
      recorderId: "owner-li",
      createdAt: closedBatch.createdAt,
      review: null,
    },
    // 未结束批次：报时一致但缺航距 → held
    {
      id: "e-03",
      batchId: openBatch.id,
      ringNo: "CHN-24-002114",
      ownerReportedAt: new Date(release02 + 5500 * 1000).toISOString(),
      sensorReportedAt: new Date(release02 + 5500 * 1000 + 10 * 1000).toISOString(),
      recorderId: "owner-li",
      createdAt: t(-20 * 60 * 60 * 1000),
      review: null,
    },
    // 鸽主/传感器报时不一致 → disputed，双方原值都保留
    {
      id: "e-04",
      batchId: openBatch.id,
      ringNo: "CHN-23-008771",
      ownerReportedAt: new Date(release02 + 4200 * 1000).toISOString(),
      sensorReportedAt: new Date(release02 + 6100 * 1000).toISOString(),
      recorderId: "owner-li",
      createdAt: t(-20 * 60 * 60 * 1000),
      review: null,
    },
    // 归巢早于放飞 → held
    {
      id: "e-05",
      batchId: openBatch.id,
      ringNo: "CHN-23-005518",
      ownerReportedAt: new Date(release02 - 1800 * 1000).toISOString(),
      sensorReportedAt: null,
      recorderId: "owner-li",
      createdAt: t(-20 * 60 * 60 * 1000),
      review: null,
    },
    // 双方报时都缺失 → noreturn，进入未归巢提醒
    {
      id: "e-06",
      batchId: openBatch.id,
      ringNo: "CHN-24-003207",
      ownerReportedAt: null,
      sensorReportedAt: null,
      recorderId: "owner-li",
      createdAt: t(-20 * 60 * 60 * 1000),
      review: null,
    },
  ];

  return {
    version: 1,
    batches: [openBatch, closedBatch],
    entries,
    pigeons,
  };
}
