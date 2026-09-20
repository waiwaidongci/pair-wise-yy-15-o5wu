import { useMemo, useState } from "react";
import { distanceBand, evaluateEntry } from "../domain/rules";
import { fmtClock, fmtDateTime, fmtDistance, fmtSpeed } from "../lib/format";
import type { Batch, Entry, Pigeon } from "../domain/types";
import { FlagBadges, Panel, StatusBadge } from "./components";

/** 按血统 / 距离分级 / 状态筛选的跨批次历史成绩（只读视图） */
export function HistoryTab({
  pigeons,
  batches,
  entries,
  onOpenPigeon,
}: {
  pigeons: Pigeon[];
  batches: Batch[];
  entries: Entry[];
  onOpenPigeon: (ring: string) => void;
}) {
  const bloodlines = useMemo(
    () => [...new Set(pigeons.map((p) => p.bloodline))].sort(),
    [pigeons]
  );
  const [bloodline, setBloodline] = useState("");
  const [band, setBand] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [onlyRanked, setOnlyRanked] = useState(false);

  type Row = {
    entry: Entry;
    batch: Batch;
    pigeon: Pigeon | null;
    view: ReturnType<typeof evaluateEntry>;
  };

  const rows: Row[] = useMemo(() => {
    return entries
      .map((entry) => {
        const batch = batches.find((b) => b.id === entry.batchId)!;
        const pigeon = pigeons.find((p) => p.ring === entry.ring) ?? null;
        return { entry, batch, pigeon, view: evaluateEntry(entry, batch) };
      })
      .filter((r) => {
        if (bloodline && r.pigeon?.bloodline !== bloodline) return false;
        if (band !== "全部" && distanceBand(r.batch.distanceM) !== band) return false;
        if (status !== "全部" && r.view.status !== statusKey(status)) return false;
        if (onlyRanked && r.view.status !== "valid") return false;
        return true;
      })
      .sort((a, b) => b.batch.releaseTime.localeCompare(a.batch.releaseTime));
  }, [entries, batches, pigeons, bloodline, band, status, onlyRanked]);

  const ranked = useMemo(
    () => rows.filter((r) => r.view.status === "valid").sort((a, b) => (b.view.speedMpm ?? 0) - (a.view.speedMpm ?? 0)),
    [rows]
  );

  return (
    <Panel
      title="历史成绩"
      hint="按血统筛选，支持距离分级与状态过滤；仅核验通过者参与排名口径"
      actions={
        <div className="filter-bar">
          <select value={bloodline} onChange={(e) => setBloodline(e.target.value)} aria-label="血统">
            <option value="">全部血统</option>
            {bloodlines.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select value={band} onChange={(e) => setBand(e.target.value)} aria-label="距离分级">
            {["全部", "短距离", "中距离", "长距离", "未设航距"].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="状态">
            {["全部", "已核验", "待复核", "未归巢", "复核无效"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={onlyRanked} onChange={(e) => setOnlyRanked(e.target.checked)} />
            只看上榜成绩
          </label>
        </div>
      }
    >
      <p className="result-count">共 {rows.length} 条记录，其中 {ranked.length} 条核验通过</p>
      {rows.length === 0 ? (
        <p className="empty-note">没有符合筛选条件的记录。</p>
      ) : (
        <table className="data-table wide">
          <thead>
            <tr>
              <th>放飞时间</th><th>批次</th><th>足环号</th><th>血统</th>
              <th>航距/分级</th><th>归巢</th><th>分速</th><th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entry.id}>
                <td>{fmtDateTime(r.batch.releaseTime)}</td>
                <td>
                  {r.batch.name}
                  <small className="sub">{r.batch.location}</small>
                </td>
                <td>
                  <button className="link-btn" onClick={() => onOpenPigeon(r.entry.ring)}>
                    {r.entry.ring}
                  </button>
                </td>
                <td>{r.pigeon?.bloodline ?? "未建档"}</td>
                <td>{fmtDistance(r.batch.distanceM)} · {distanceBand(r.batch.distanceM)}</td>
                <td className="raw-time">{fmtClock(r.view.arrivalTime)}</td>
                <td>{fmtSpeed(r.view.speedMpm)}</td>
                <td><StatusBadge status={r.view.status} /> <FlagBadges flags={r.view.flags} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function statusKey(label: string): string {
  switch (label) {
    case "已核验": return "valid";
    case "待复核": return "review";
    case "未归巢": return "pending-time";
    case "复核无效": return "void";
    default: return "";
  }
}
