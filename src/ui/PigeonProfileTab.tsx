import { useState } from "react";
import { distanceBand, evaluateEntry, ranking } from "../domain/rules";
import { repository, type RepoResult } from "../storage/repository";
import {
  fmtClock,
  fmtDateTime,
  fmtDistance,
  fmtMin,
  fmtSpeed,
} from "../lib/format";
import type { Batch, Entry, EntryView, Pigeon } from "../domain/types";
import { Field, FlagBadges, Panel, ResultBanner, StatusBadge } from "./components";

/** 单羽档案：基础信息 + 跨批次参与历史，全部与列表/排行共用同一推导 */
export function PigeonProfileTab({
  ring,
  pigeons,
  batches,
  entries,
  pushToast,
}: {
  ring: string | null;
  pigeons: Pigeon[];
  batches: Batch[];
  entries: Entry[];
  pushToast: (t: { kind: "ok" | "error"; status?: number; message: string }) => void;
}) {
  const pigeon = pigeons.find((p) => p.ring === ring) ?? null;
  const [bloodline, setBloodline] = useState(pigeon?.bloodline ?? "");
  const [health, setHealth] = useState(pigeon?.health ?? "");
  const [mateRing, setMateRing] = useState(pigeon?.mateRing ?? "");
  const [error, setError] = useState<RepoResult<unknown> | null>(null);

  if (!pigeon) {
    return (
      <Panel title="单羽赛鸽档案" hint="从鸽棚总览选择一羽赛鸽">
        <p className="empty-note">请在「鸽棚总览」中点击足环号查看档案。</p>
      </Panel>
    );
  }

  // 父组件以 ring 为 key 保证切换鸽子时整体重新挂载，本地表单状态从档案初始化

  const history = entries
    .filter((e) => e.ring === pigeon.ring)
    .map((e) => {
      const batch = batches.find((b) => b.id === e.batchId)!;
      const view = evaluateEntry(e, batch);
      const rank = ranking(entries, batch).find((r) => r.entry.id === e.id)?.rank ?? null;
      return { entry: e, batch, view, rank };
    })
    .sort((a, b) => b.batch.releaseTime.localeCompare(a.batch.releaseTime));

  const validRuns = history.filter((h) => h.view.status === "valid");
  const best = validRuns.reduce<EntryView | null>(
    (best, h) => (best == null || (h.view.speedMpm ?? 0) > (best.speedMpm ?? 0) ? h.view : best),
    null
  );

  async function saveProfile() {
    const res = await repository.updatePigeon(pigeon!.ring, { bloodline, health, mateRing });
    if (res.ok) {
      setError(null);
      pushToast({ kind: "ok", status: res.status, message: "档案已更新" });
    } else {
      setError(res);
      pushToast({ kind: "error", status: res.status, message: res.message });
    }
  }

  return (
    <div className="tab-stack">
      <Panel title={`单羽档案 · ${pigeon.ring}`} hint={`血统 ${pigeon.bloodline}`}>
        <div className="stat-strip">
          <span><b>{history.length}</b> 次上笼</span>
          <span><b>{validRuns.length}</b> 次核验通过</span>
          <span><b>{history.filter(h => h.view.status === "review").length}</b> 次待复核</span>
          <span><b>{history.filter(h => h.view.status === "void").length}</b> 次判无效</span>
          <span><b>{fmtSpeed(best?.speedMpm ?? null)}</b> 历史最佳分速</span>
        </div>
        <ResultBanner result={error} />
        <div className="form-grid">
          <Field label="血统">
            <input value={bloodline} onChange={(e) => setBloodline(e.target.value)} />
          </Field>
          <Field label="健康状态">
            <input value={health} onChange={(e) => setHealth(e.target.value)} />
          </Field>
          <Field label="配对足环号">
            <input value={mateRing} onChange={(e) => setMateRing(e.target.value)} placeholder="可留空" />
          </Field>
          <div className="form-action">
            <button className="primary" onClick={saveProfile}>保存档案</button>
          </div>
        </div>
      </Panel>

      <Panel title="训放参与历史" hint="名次/状态/分速均实时按当前批次参数推导，与排行页一致">
        {history.length === 0 ? (
          <p className="empty-note">还没有上笼记录。</p>
        ) : (
          <table className="data-table wide">
            <thead>
              <tr>
                <th>批次</th><th>放飞时间</th><th>航距/分级</th>
                <th>鸽主报时</th><th>传感器报时</th><th>差异</th>
                <th>归巢</th><th>分速</th><th>名次</th><th>状态</th><th>复核人</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.entry.id}>
                  <td>
                    {h.batch.name}
                    <small className="sub">{h.batch.location}</small>
                  </td>
                  <td>{fmtDateTime(h.batch.releaseTime)}</td>
                  <td>{fmtDistance(h.batch.distanceM)} · {distanceBand(h.batch.distanceM)}</td>
                  <td className="raw-time">{fmtClock(h.entry.ownerTime)}</td>
                  <td className="raw-time">{fmtClock(h.entry.sensorTime)}</td>
                  <td>{fmtMin(h.view.discrepancyMin)}</td>
                  <td className="raw-time">{fmtClock(h.view.arrivalTime)}</td>
                  <td>{fmtSpeed(h.view.speedMpm)}</td>
                  <td>{h.rank ? `#${h.rank}` : "—"}</td>
                  <td><StatusBadge status={h.view.status} /> <FlagBadges flags={h.view.flags} /></td>
                  <td>{h.entry.reviewer ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
