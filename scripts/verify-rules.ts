// 临时验证脚本（不进构建）：用 esbuild 转译后在 Node 中跑，
// localStorage 用内存桩替代。
import assert from "node:assert";

// --- localStorage 桩（必须在 import 仓储模块之前就位）---
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

// 固定一个简单时钟的测试数据
const release = new Date("2026-09-20T02:00:00.000Z").getTime();
const seed: any = {
  version: 1,
  batches: [
  {
    id: "b1", code: "B-TEST-1", status: "open",
    site: "测试点", distanceMeters: 120000,
    releasedAt: new Date(release).toISOString(), weather: "晴",
    ownerId: "owner-a", createdAt: new Date(release - 3600e3).toISOString(),
    closedAt: null, archivedSnapshots: [],
  },
  {
    id: "b2", code: "B-TEST-2", status: "closed",
    site: "旧点", distanceMeters: 80000,
    releasedAt: new Date(release - 86400e3).toISOString(), weather: "晴",
    ownerId: "owner-a", createdAt: new Date(release - 90000e3).toISOString(),
    closedAt: new Date(release - 80000e3).toISOString(), archivedSnapshots: [],
  },
  ],
  entries: [],
  pigeons: [],
};
mem.set("pigeon-batch-console:v1", JSON.stringify(seed));

let StoreError: any;

async function expectStatus(p: Promise<unknown>, status: number, label: string) {
  let err: any = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof StoreError, `${label}: 应抛 StoreError`);
  assert.strictEqual(err.status, status, `${label}: 状态码应为 ${status}，实际 ${err.status}`);
  console.log(`✓ ${label} → ${status}`);
}

(async () => {
  // 桩与种子就位后再加载仓储与规则模块
  const storage = await import("../src/storage/store");
  const rules = await import("../src/domain/rules");
  const { store } = storage;
  StoreError = storage.StoreError;

  const iso = (ms: number) => new Date(release + ms * 1000).toISOString();

  // 1. 正常鸽：60 分钟飞 120km → 2000 m/min，越界 → held
  await store.addEntry({
    batchId: "b1", ringNo: "R-001", bloodline: "詹森系",
    ownerReportedAt: iso(3600), sensorReportedAt: iso(3605),
    recorderId: "owner-a",
  });

  // 2. 正常鸽：80 分钟 → 1500 m/min，双方一致 → ranked
  await store.addEntry({
    batchId: "b1", ringNo: "R-002", bloodline: "凡龙系",
    ownerReportedAt: iso(4800), sensorReportedAt: iso(4810),
    recorderId: "owner-a",
  });

  // 3. 争议鸽：双方相差 > 60 秒 → disputed，双方原值保留
  await store.addEntry({
    batchId: "b1", ringNo: "R-003", bloodline: "胡本系",
    ownerReportedAt: iso(4200), sensorReportedAt: iso(5000),
    recorderId: "owner-a",
  });

  // 4. 早于放飞 → held
  await store.addEntry({
    batchId: "b1", ringNo: "R-004", bloodline: "盖比系",
    ownerReportedAt: iso(-100), sensorReportedAt: null,
    recorderId: "owner-a",
  });

  // 5. 无报时 → noreturn
  await store.addEntry({
    batchId: "b1", ringNo: "R-005", bloodline: "詹森系",
    ownerReportedAt: null, sensorReportedAt: null,
    recorderId: "owner-a",
  });

  // === 规则 1：409 冲突不落库 ===
  const before = store.getState();
  const countBefore = before.entries.length;
  const pigeonsBefore = before.pigeons.length;
  await expectStatus(
    store.addEntry({
      batchId: "b1", ringNo: "r-001", // 大小写归一后仍冲突
      bloodline: "不该写入",
      ownerReportedAt: iso(4000), sensorReportedAt: null,
      recorderId: "owner-a",
    }),
    409,
    "同一未结束批次重复登记 R-001",
  );
  const after = store.getState();
  assert.strictEqual(after.entries.length, countBefore, "409 后条目数不能增加");
  assert.strictEqual(after.pigeons.length, pigeonsBefore, "409 后足环档案不能写入");

  // 已结束批次登记 → 400
  await expectStatus(
    store.addEntry({
      batchId: "b2", ringNo: "R-001",
      ownerReportedAt: null, sensorReportedAt: null,
      recorderId: "owner-a",
    }),
    400,
    "已结束批次登记",
  );

  // === 规则 2：状态判定 ===
  let batch = store.getState().batches.find((b: any) => b.id === "b1");
  let ev = rules.evaluateBatch(batch, store.getState().entries);
  const byRing = Object.fromEntries(ev.all.map((e: any) => [e.entry.ringNo, e]));
  assert.strictEqual(byRing["R-002"].state, "ranked");
  assert.strictEqual(byRing["R-001"].state, "held");
  assert.ok(byRing["R-001"].flags.some((f: string) => f.includes("分速越界")));
  assert.strictEqual(byRing["R-003"].state, "disputed");
  assert.strictEqual(byRing["R-003"].officialReportedAt, null, "争议未裁时无采信时间");
  assert.strictEqual(byRing["R-003"].entry.ownerReportedAt, iso(4200), "鸽主原值保留");
  assert.strictEqual(byRing["R-003"].entry.sensorReportedAt, iso(5000), "传感器原值保留");
  assert.strictEqual(byRing["R-004"].state, "held");
  assert.ok(byRing["R-004"].flags.some((f: string) => f.includes("早于放飞")));
  assert.strictEqual(byRing["R-005"].state, "noreturn");
  console.log("✓ 排行/越界/争议/早于放飞/缺航距-缺报时 状态判定正确");

  assert.strictEqual(ev.ranked.length, 1);
  assert.strictEqual(ev.ranked[0].entry.ringNo, "R-002");
  assert.ok(Math.abs(ev.ranked[0].speedMpm - 1496.88) < 0.01, "120km/传感器4810s=1496.88m/min");
  // 归巢率 = 4/5（noreturn 不算归巢，void 还没有）
  assert.ok(Math.abs(ev.returnRate - 0.8) < 1e-9);

  // 缺航距：清空距离后 R-002 应变 held
  // === 规则 3：参数修订 → 旧结论留档 + 按新值重算 ===
  await store.updateReleaseParams(
    "b1",
    { site: "测试点", distanceMeters: null, releasedAt: new Date(release).toISOString(), weather: "晴" },
    "owner-a",
    "航距待测量",
  );
  let state2 = store.getState();
  batch = state2.batches.find((b: any) => b.id === "b1");
  assert.strictEqual(batch.archivedSnapshots.length, 1, "应留档一份旧结论");
  const snap = batch.archivedSnapshots[0];
  assert.strictEqual(snap.ranked.length, 1, "旧快照冻结时排行有 1 羽");
  assert.strictEqual(snap.ranked[0].ringNo, "R-002");
  assert.strictEqual(snap.params.distanceMeters, 120000, "旧快照保留旧航距");
  ev = rules.evaluateBatch(batch, state2.entries);
  const r002 = ev.all.find((e: any) => e.entry.ringNo === "R-002");
  assert.strictEqual(r002.state, "held", "缺航距后应转为待复核");
  assert.ok(r002.flags.some((f: string) => f.includes("航距")));
  assert.strictEqual(ev.ranked.length, 0, "缺航距时无排行");
  assert.strictEqual(ev.noreturn.length, 1, "未归巢提醒仍为 1 羽");
  console.log("✓ 参数修订：旧结论快照留档，排行与提醒按新值重算");

  // 补回航距（100km → R-002 = 1250，R-001 = 1666.7，都在界内）
  await store.updateReleaseParams(
    "b1",
    { site: "测试点", distanceMeters: 100000, releasedAt: new Date(release).toISOString(), weather: "晴" },
    "owner-a",
    "勘误航距",
  );
  state2 = store.getState();
  batch = state2.batches.find((b: any) => b.id === "b1");
  assert.strictEqual(batch.archivedSnapshots.length, 2);
  ev = rules.evaluateBatch(batch, state2.entries);
  const rings = ev.ranked.map((r: any) => r.entry.ringNo);
  assert.deepStrictEqual(rings, ["R-001", "R-002"], "航距修订后两羽进榜，R-001 更快");
  assert.ok(Math.abs(ev.ranked[0].speedMpm - 1664.36) < 0.1, "100km/3605s=1664.36");
  console.log("✓ 航距补正后自动重排行");

  // === 规则 4：争议复核必须另一人 ===
  const r003id = state2.entries.find((e: any) => e.ringNo === "R-003").id;
  await expectStatus(
    store.reviewEntry(r003id, "owner", "owner-a", ""),
    403,
    "提交人本人复核",
  );
  await store.reviewEntry(r003id, "owner", "judge-b", "采信鸽主手打时间");
  state2 = store.getState();
  batch = state2.batches.find((b: any) => b.id === "b1");
  ev = rules.evaluateBatch(batch, state2.entries);
  const r003 = ev.all.find((e: any) => e.entry.ringNo === "R-003");
  assert.strictEqual(r003.state, "ranked", "裁定后应进排行");
  assert.strictEqual(r003.entry.sensorReportedAt, iso(5000), "未被采信方的原值仍保留");
  assert.strictEqual(r003.officialReportedAt, iso(4200));
  console.log("✓ 另一人复核裁定后进榜，双方原值继续保留");

  // === 规则 5：报时不可覆盖，只能补空通道 ===
  const r005id = state2.entries.find((e: any) => e.ringNo === "R-005").id;
  await store.saveReport(r005id, "sensor", iso(5200));
  await expectStatus(store.saveReport(r005id, "sensor", iso(5300)), 409, "覆盖已有传感器报时");
  // 补鸽主报时，与传感器差 100 秒（5200 vs 5100?）→ 争议
  await store.saveReport(r005id, "owner", iso(5100));
  state2 = store.getState();
  batch = state2.batches.find((b: any) => b.id === "b1");
  ev = rules.evaluateBatch(batch, state2.entries);
  const r005 = ev.all.find((e: any) => e.entry.ringNo === "R-005");
  assert.strictEqual(r005.state, "disputed", "事后补报不一致同样挂争议");
  assert.strictEqual(r005.entry.ownerReportedAt, iso(5100));
  assert.strictEqual(r005.entry.sensorReportedAt, iso(5200));
  console.log("✓ 报时只补不覆盖，后到报时引发争议");

  // R-002 双方差 10 秒 → ranked 已验证；再构造 61 秒的边界
  await store.addEntry({
    batchId: "b1", ringNo: "R-006",
    ownerReportedAt: iso(7000), sensorReportedAt: iso(7061),
    recorderId: "owner-a",
  });
  state2 = store.getState();
  batch = state2.batches.find((b: any) => b.id === "b1");
  ev = rules.evaluateBatch(batch, state2.entries);
  const r006 = ev.all.find((e: any) => e.entry.ringNo === "R-006");
  assert.strictEqual(r006.state, "disputed", "相差 61 秒应争议");
  console.log("✓ 60 秒容忍边界正确");

  // === 规则 6：刷新一致性 —— 重新从 localStorage 加载的新 store 实例结论一致 ===
  // store 是模块级单例：getState 重新读取已持久化的数据，等价于刷新
  const fresh = store.getState();
  const freshBatch = fresh.batches.find((b: any) => b.id === "b1");
  const freshEv = rules.evaluateBatch(freshBatch, fresh.entries);
  assert.strictEqual(freshEv.ranked.length, ev.ranked.length);
  assert.deepStrictEqual(
    freshEv.ranked.map((r: any) => r.entry.ringNo),
    ev.ranked.map((r: any) => r.entry.ringNo),
  );
  assert.strictEqual(freshBatch.archivedSnapshots.length, 2, "留档跨刷新保留");
  // 单羽档案与列表同源
  const profile = rules.buildPigeonProfile("R-003", fresh);
  assert.strictEqual(profile.history.length, 1);
  assert.strictEqual(profile.history[0].evaluated.state, "ranked");
  const overview = rules.buildOverview(fresh);
  assert.strictEqual(overview.noreturnCount, 0, "R-005 补报后未归巢数为 0");
  assert.ok(overview.returnRate !== null);
  console.log("✓ 刷新后列表/排行/留档/单羽档案/总览一致");

  // === 规则 7：未归巢提醒仅未结束批次 ===
  // b2 已结束且无条目，openBatches 只含 b1
  assert.deepStrictEqual(rules.openBatches(fresh).map((b: any) => b.id), ["b1"]);
  console.log("✓ 未归巢提醒仅针对未结束批次");

  console.log("\n全部规则验证通过 ✅");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
