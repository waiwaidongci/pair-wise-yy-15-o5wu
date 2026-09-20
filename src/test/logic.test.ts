// 端到端规则校验：node 环境下 mock localStorage/window，直接跑存储层+规则层。
// 运行：npx esbuild src/test/logic.test.ts --bundle --platform=node --format=cjs | node
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};
(globalThis as any).window = { dispatchEvent: () => undefined };

import { repository } from "../storage/repository";
import { batchStats, evaluateBatch, notReturned, ranking } from "../domain/rules";
import type { Batch } from "../domain/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name} ${extra}`);
  }
}

async function snapshot() {
  return repository.list();
}
function openBatch(batches: Batch[]) {
  return batches.find((b) => b.status === "open")!;
}

async function main() {
  await repository.reset();
  let db = await snapshot();
  const batch = openBatch(db.batches);

  console.log("\n[1] 同一未结束批次重复上笼 → 409 且不落库");
  const before = db.entries.length;
  const dup = await repository.register(batch.id, "CHN-24-001839", "测试人");
  check("返回 409", dup.ok === false && !dup.ok && dup.status === 409, JSON.stringify(dup));
  db = await snapshot();
  check("记录数不变（不落库）", db.entries.length === before);

  console.log("\n[2] 批次结束后不能再登记 → 400");
  const otherPigeon = "CHN-23-008771";
  const reg = await repository.register(batch.id, otherPigeon, "测试人");
  check("未结束时可登记", reg.ok === true && reg.status === 201);
  await repository.closeBatch(batch.id);
  const afterClose = await repository.register(batch.id, "CHN-24-003502", "测试人");
  check("结束后登记被拒", afterClose.ok === false && afterClose.status === 400);

  console.log("\n[3] 种子数据：异常记录只留待复核，不进排行");
  // 重置并在仍 open 的批次上检查
  await repository.reset();
  db = await snapshot();
  const open = openBatch(db.batches);
  const rows = ranking(db.entries, open);
  check("排行只有两路报时齐全且速度合理的记录", rows.every((r) => r.status === "valid"));
  const flagsByRing = new Map(
    [...evaluateBatch(db.entries, open).values()].map((v) => [v.ring, v])
  );
  check("报时不一致 → time-conflict", flagsByRing.get("CHN-24-003502")!.flags.includes("time-conflict"));
  check("报时不一致双方原值保留",
    db.entries.find((e) => e.ring === "CHN-24-003502" && e.batchId === open.id)!.ownerTime !== null &&
    db.entries.find((e) => e.ring === "CHN-24-003502" && e.batchId === open.id)!.sensorTime !== null);
  check("单路报时 → missing-times", flagsByRing.get("CHN-24-004218")!.flags.includes("missing-times"));
  check("早于放飞 → early", flagsByRing.get("CHN-25-002660")!.flags.includes("early"));
  check("速度越界 → speed-out", flagsByRing.get("CHN-25-003992")!.flags.includes("speed-out"));
  check("问题记录均不进排行", rows.every((r) => !["CHN-24-003502", "CHN-24-004218", "CHN-25-002660", "CHN-25-003992"].includes(r.ring)));
  check("排行按分速降序", rows.every((r, i) => i === 0 || rows[i - 1].speedMpm! >= r.speedMpm!));

  console.log("\n[4] 未归巢提醒：无任何报时才算");
  const missing = notReturned(db.entries, open).map((v) => v.ring);
  check("CHN-24-002114 在提醒中", missing.includes("CHN-24-002114"));
  check("待复核鸽不在未归巢中", !missing.includes("CHN-24-004218"));

  console.log("\n[5] 重复归巢报时 → 409 且原值不变");
  const entry1839 = db.entries.find((e) => e.batchId === open.id && e.ring === "CHN-24-001839")!;
  const originalOwner = entry1839.ownerTime;
  const dupReport = await repository.report(
    open.id, "CHN-24-001839", "某人",
    { ownerTime: "2026-09-20T09:00", sensorTime: "2026-09-20T09:01" }
  );
  check("返回 409", dupReport.ok === false && dupReport.status === 409);
  db = await snapshot();
  const again = db.entries.find((e) => e.id === entry1839.id)!;
  check("原值保留、未被覆盖", again.ownerTime === originalOwner);

  console.log("\n[6] 复核人必须是另一人");
  const target = db.entries.find((e) => e.batchId === open.id && e.ring === "CHN-24-003502")!;
  const selfReview = await repository.review(target.id, "助手小王", {
    action: "accept", adjudicatedTime: "2026-09-20T08:48:00",
  });
  check("报时人本人复核 → 409", selfReview.ok === false && selfReview.status === 409);
  const otherReview = await repository.review(target.id, "李教练", {
    action: "accept", adjudicatedTime: "2026-09-20T08:48:00", note: "人工取双方折中",
  });
  check("第三方复核接受 → 200", otherReview.ok === true);
  db = await snapshot();
  const afterReview = evaluateBatch(
    db.entries,
    open
  ).get(db.entries.find((e) => e.id === target.id)!.id)!;
  check("采信后进入排行且速度按认定时间计算", afterReview.status === "valid" && afterReview.speedMpm != null);
  const ranksAfterReview = ranking(db.entries, open).map((r) => r.ring);
  check("3502 已上榜", ranksAfterReview.includes("CHN-24-003502"));

  console.log("\n[7] 放飞参数改动 → 旧结论留档，排行/提醒按新值重算");
  const beforeRanks = ranking(db.entries, open);
  const beforeStats = batchStats(db.entries, open);
  check("改前 2114 未归巢", beforeStats.notReturned === 1);
  const upd = await repository.updateReleaseParams(open.id, "教练组成员", {
    location: open.location,
    releaseTime: "2026-09-20T07:00", // 放飞提前 30 分钟
    distanceM: 100000, // 航距改为 100km
    weather: open.weather,
  });
  check("参数更新成功", upd.ok === true);
  db = await snapshot();
  const updatedOpen = db.batches.find((b) => b.id === open.id)!;
  check("新航距生效", updatedOpen.distanceM === 100000);
  const afterRanks = ranking(db.entries, updatedOpen);
  check("排行羽数/顺序可能变化（按新值重算）",
    afterRanks.length >= 1 &&
    afterRanks.every((r, i) => i === 0 || afterRanks[i - 1].speedMpm! >= r.speedMpm!));
  // 1107 原 08:32 归巢，62 分钟飞 80km≈1290；新参数 92 分钟飞 100km≈1087
  const v1107 = evaluateBatch(db.entries, updatedOpen).get(
    db.entries.find((e) => e.batchId === open.id && e.ring === "CHN-25-001107")!.id
  )!;
  check("1107 速度按新参数重算 ≈1087", v1107.status === "valid" && Math.abs(v1107.speedMpm! - 1086.96) < 1);
  // 2660 原来 07:20 早于 07:30 → early；放飞改为 07:00 后 07:20 晚于放飞，
  // 但 100km/20min=5000 越界 → 自动转 speed-out，仍只待复核（结论重算）
  const v2660 = evaluateBatch(db.entries, updatedOpen).get(
    db.entries.find((e) => e.batchId === open.id && e.ring === "CHN-25-002660")!.id
  )!;
  check("2660 从 early 重算为 speed-out，依旧不进排行",
    v2660.flags.includes("speed-out") && !v2660.flags.includes("early") && v2660.status === "review");
  // 留档内容（取本次更新生成的那条）
  const archive = upd.ok
    ? db.archives.find((a) => a.id === (upd as any).data.archive.id)!
    : db.archives[0];
  check("留档存在且带改动前每羽结论快照",
    archive && archive.before.releaseTime === "2026-09-20T07:30:00" &&
    archive.before.distanceM === 80000 &&
    archive.after.releaseTime === "2026-09-20T07:00" &&
    archive.conclusions.length === db.entries.filter((e) => e.batchId === open.id).length);
  const snap1839 = archive.conclusions.find((c) => c.ring === "CHN-24-001839")!;
  check("旧结论档中 1839 为旧参数下 valid", snap1839.status === "valid");

  console.log("\n[8] 缺航距批次：归巢只能待复核，补齐航距后自动可核验");
  const created = await repository.createBatch({
    location: "西线临时点",
    releaseTime: "2026-09-21T07:30",
    distanceM: null,
    weather: "阴",
  });
  check("无航距批次可创建（待补录）", created.ok === true);
  const nb = (created as any).data as Batch;
  await repository.register(nb.id, "CHN-24-001839", "鸽主老陈");
  await repository.report(nb.id, "CHN-24-001839", "助手小王", {
    ownerTime: "2026-09-21T08:40:00",
    sensorTime: "2026-09-21T08:40:05",
  });
  db = await snapshot();
  const noDist = evaluateBatch(db.entries, db.batches.find((b) => b.id === nb.id)!).values();
  const nv = [...noDist][0];
  check("缺航距 → no-distance 待复核，不进排行", nv.flags.includes("no-distance") && nv.status === "review");
  check("缺航距批次排行为空", ranking(db.entries, db.batches.find((b) => b.id === nb.id)!).length === 0);
  await repository.updateReleaseParams(nb.id, "教练组成员", {
    location: "西线临时点",
    releaseTime: "2026-09-21T07:30",
    distanceM: 80000,
    weather: "阴",
  });
  db = await snapshot();
  const fixed = evaluateBatch(db.entries, db.batches.find((b) => b.id === nb.id)!).values();
  const fv = [...fixed][0];
  check("补齐航距后自动核验通过（无需改报时）", fv.status === "valid" && fv.speedMpm != null);

  console.log("\n[9] 刷新一致性：重新从 localStorage 读取，结论完全一致");
  const reloaded = await repository.list();
  const rb = reloaded.batches.find((b) => b.id === nb.id)!;
  const reloadedRank = ranking(reloaded.entries, rb).map((r) => `${r.ring}:${Math.round(r.speedMpm!)}`);
  db = await snapshot();
  const currentRank = ranking(db.entries, rb).map((r) => `${r.ring}:${Math.round(r.speedMpm!)}`);
  check("重载后排行一致", JSON.stringify(reloadedRank) === JSON.stringify(currentRank));

  console.log("\n[10] 统计与列表口径一致");
  db = await snapshot();
  const b2 = openBatch(db.batches);
  const views = [...evaluateBatch(db.entries, b2).values()];
  const st = batchStats(db.entries, b2);
  check("registered 口径一致", st.registered === views.length);
  check("valid 口径一致", st.valid === views.filter((v) => v.status === "valid").length);
  check("review 口径一致", st.review === views.filter((v) => v.status === "review").length);
  check("未归巢口径一致", st.notReturned === notReturned(db.entries, b2).length);
  check("归巢率 = 已报时/上笼", Math.abs(st.returnRate! - ((st.registered - st.notReturned) / st.registered) * 100) < 0.2);

  console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
