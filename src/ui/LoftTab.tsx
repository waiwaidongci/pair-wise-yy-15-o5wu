import { useState } from "react";
import { evaluateEntry, loftStats } from "../domain/rules";
import { repository } from "../storage/repository";
import { fmtDateTime, fmtSpeed } from "../lib/format";
import type { LoftState } from "./useLoft";
import { EmptyNote, Field, FlagBadges, Panel, ResultBanner, StatusBadge } from "./components";
import type { RepoResult } from "../storage/repository";

export function LoftTab({
  loft,
  pushToast,
  onOpenPigeon,
}: {
  loft: LoftState;
  pushToast: (t: { kind: "ok" | "error"; status?: number; message: string }) => void;
  onOpenPigeon: (ring: string) => void;
}) {
  const stats = loftStats(loft.pigeons, loft.batches, loft.entries);
  const [ring, setRing] = useState("");
  const [bloodline, setBloodline] = useState("");
  const [health, setHealth] = useState("健康正常");
  const [mateRing, setMateRing] = useState("");
  const [error, setError] = useState<RepoResult<unknown> | null>(null);

  async function createPigeon() {
    const res = await repository.createPigeon({ ring, bloodline, health, mateRing });
    if (res.ok) {
      setError(null);
      setRing("");
      setBloodline("");
      setMateRing("");
      pushToast({ kind: "ok", status: res.status, message: "赛鸽档案已建立" });
    } else {
      setError(res);
      pushToast({ kind: "error", status: res.status, message: res.message });
    }
  }

  const metricCards = [
    { label: "在册赛鸽", value: String(stats.pigeonCount) },
    { label: "训放批次", value: `${stats.batchCount}（未结束 ${stats.openBatchCount}）` },
    { label: "累计上笼", value: String(stats.entriesTotal) },
    { label: "核验通过", value: String(stats.validTotal) },
    { label: "待复核", value: String(stats.reviewTotal), warn: stats.reviewTotal > 0 },
    { label: "未归巢", value: String(stats.notReturnedTotal), warn: stats.notReturnedTotal > 0 },
    { label: "跨批平均速度", value: fmtSpeed(stats.avgSpeed) },
  ];

  return (
    <div className="tab-stack">
      <Panel title="鸽棚总览" hint="全部指标由同一规则层从原始上笼记录实时推导">
        <div className="metric-grid">
          {metricCards.map((m) => (
            <article key={m.label} className={m.warn ? "metric-warn" : ""}>
              <small>{m.label}</small>
              <strong>{m.value}</strong>
            </article>
          ))}
        </div>
        <div className="bloodline-bar">
          <h3>血统分布</h3>
          {stats.bloodlines.length === 0 ? (
            <EmptyNote>暂无档案</EmptyNote>
          ) : (
            <div className="bars">
              {stats.bloodlines.map((b) => {
                const pct = Math.round((b.count / stats.pigeonCount) * 100);
                return (
                  <div key={b.name} className="bar-row">
                    <span className="bar-name">{b.name}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="bar-count">{b.count} 羽</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="新建单羽档案" hint="足环号重复建档返回 409 且不落库">
        <ResultBanner result={error} />
        <div className="form-grid">
          <Field label="足环号 *">
            <input value={ring} onChange={(e) => setRing(e.target.value)} placeholder="CHN-XX-XXXXXX" />
          </Field>
          <Field label="血统">
            <input value={bloodline} onChange={(e) => setBloodline(e.target.value)} placeholder="如：詹森系" />
          </Field>
          <Field label="健康状态">
            <input value={health} onChange={(e) => setHealth(e.target.value)} />
          </Field>
          <Field label="配对足环号">
            <input value={mateRing} onChange={(e) => setMateRing(e.target.value)} placeholder="可留空" />
          </Field>
          <div className="form-action span-2">
            <button className="primary" disabled={!ring.trim()} onClick={createPigeon}>
              建立档案
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="赛鸽档案册" hint="点击足环号查看单羽档案">
        <table className="data-table">
          <thead>
            <tr>
              <th>足环号</th><th>血统</th><th>健康状态</th><th>配对</th>
              <th>上笼批次数</th><th>最近状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loft.pigeons.map((p) => {
              const myEntries = loft.entries
                .filter((e) => e.ring === p.ring)
                .sort(
                  (a, b) =>
                    loft.batches.find((x) => x.id === b.batchId)!.releaseTime.localeCompare(
                      loft.batches.find((x) => x.id === a.batchId)!.releaseTime
                    )
                );
              const latest = myEntries[0];
              const latestBatch = latest
                ? loft.batches.find((b) => b.id === latest.batchId)
                : null;
              const latestView =
                latest && latestBatch ? evaluateEntry(latest, latestBatch) : null;
              return (
                <tr key={p.ring}>
                  <td>
                    <button className="link-btn" onClick={() => onOpenPigeon(p.ring)}>
                      {p.ring}
                    </button>
                  </td>
                  <td>{p.bloodline}</td>
                  <td>{p.health}</td>
                  <td>{p.mateRing || "—"}</td>
                  <td>{myEntries.length}</td>
                  <td>
                    {latestView ? (
                      <>
                        <StatusBadge status={latestView.status} /> <FlagBadges flags={latestView.flags} />
                      </>
                    ) : (
                      "未参加训放"
                    )}
                  </td>
                  <td className="nowrap">建档 {fmtDateTime(p.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
