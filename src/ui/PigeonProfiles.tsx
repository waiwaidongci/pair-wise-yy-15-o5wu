import { useMemo, useState } from "react";
import { EntryState } from "../domain/types";
import { buildPigeonProfile, formatDuration, formatMpm, STATE_LABEL } from "../domain/rules";
import { StoreError, store } from "../storage/store";
import { formatDateTime } from "./time";
import { ConsoleProps } from "./types";

const STATE_CLASS: Record<EntryState, string> = {
  ranked: "tag tag-ranked",
  held: "tag tag-held",
  disputed: "tag tag-disputed",
  noreturn: "tag tag-noreturn",
  void: "tag tag-void",
};

function PigeonCard({ ringNo, data }: { ringNo: string; data: ConsoleProps["data"] }) {
  const profile = buildPigeonProfile(ringNo, data);
  const [editing, setEditing] = useState(false);
  const [health, setHealth] = useState(profile?.pigeon.health ?? "");
  const [pairing, setPairing] = useState(profile?.pigeon.pairing ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!profile) return null;

  async function save() {
    setError(null);
    try {
      await store.updatePigeon(ringNo, { health, pairing });
      setEditing(false);
    } catch (err) {
      setError(err instanceof StoreError ? err.message : "保存失败");
    }
  }

  return (
    <article className="pigeon-card">
      <header>
        <div>
          <h3>{profile.pigeon.ringNo}</h3>
          <span className="lineage">{profile.pigeon.bloodline}</span>
        </div>
        <button onClick={() => setEditing((v) => !v)}>{editing ? "收起" : "编辑档案"}</button>
      </header>

      {editing ? (
        <div className="subform">
          {error && <div className="banner banner-error">{error}</div>}
          <label>
            <span>健康状态</span>
            <input value={health} onChange={(e) => setHealth(e.target.value)} />
          </label>
          <label>
            <span>配对记录</span>
            <input value={pairing} onChange={(e) => setPairing(e.target.value)} />
          </label>
          <div className="actions">
            <button className="primary" onClick={save}>保存</button>
          </div>
        </div>
      ) : (
        <p className="muted">健康：{profile.pigeon.health} · 配对：{profile.pigeon.pairing}</p>
      )}

      <div className="pigeon-stats">
        <span>参批 {profile.history.length} 次</span>
        <span>进榜 {profile.rankedCount} 次</span>
        <span>最佳分速 {formatMpm(profile.bestSpeedMpm)}</span>
      </div>

      <div className="table-wrap">
        <table className="entry-table">
          <thead>
            <tr><th>批次</th><th>批次状态</th><th>鸽主报时</th><th>传感器报时</th><th>耗时</th><th>分速</th><th>核验状态</th></tr>
          </thead>
          <tbody>
            {profile.history.map((h) => (
              <tr key={h.evaluated.entry.id} className={`row-${h.evaluated.state}`}>
                <td><b>{h.batchCode}</b></td>
                <td>{h.batchStatus === "open" ? "未结束" : "已结束"}</td>
                <td>{formatDateTime(h.evaluated.entry.ownerReportedAt)}</td>
                <td>{formatDateTime(h.evaluated.entry.sensorReportedAt)}</td>
                <td>{formatDuration(h.evaluated.durationSec)}</td>
                <td>{formatMpm(h.evaluated.speedMpm)}</td>
                <td>
                  <span className={STATE_CLASS[h.evaluated.state]}>{STATE_LABEL[h.evaluated.state]}</span>
                  {h.evaluated.flags.map((f, i) => (
                    <span key={i} className="flag">⚠ {f}</span>
                  ))}
                  {h.evaluated.entry.review && (
                    <span className="note">
                      复核：{h.evaluated.entry.review.reviewerId}
                      {h.evaluated.entry.review.note ? `（${h.evaluated.entry.review.note}）` : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function PigeonProfiles({ data }: ConsoleProps) {
  const bloodlines = useMemo(
    () => Array.from(new Set(data.pigeons.map((p) => p.bloodline))).sort((a, b) => a.localeCompare(b, "zh")),
    [data.pigeons],
  );
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");

  const visible = data.pigeons.filter((p) => {
    if (filter !== "全部" && p.bloodline !== filter) return false;
    if (query.trim() && !p.ringNo.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="overview">
      <section className="panel">
        <h2>单羽赛鸽档案</h2>
        <p className="muted">
          档案中的状态、耗时与分速均由规则层按最新放飞参数即时推导，与核验台列表、总览统计刷新后保持一致。
        </p>
        <div className="filter-bar">
          <input className="search" placeholder="按足环号搜索" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="chips">
            {["全部", ...bloodlines].map((b) => (
              <button key={b} className={filter === b ? "chip active" : "chip"} onClick={() => setFilter(b)}>
                {b}
              </button>
            ))}
          </div>
        </div>
      </section>

      {visible.length === 0 && <p className="muted">没有符合条件的赛鸽。</p>}
      {visible.map((p) => (
        <PigeonCard key={p.ringNo} ringNo={p.ringNo} data={data} />
      ))}
    </div>
  );
}
