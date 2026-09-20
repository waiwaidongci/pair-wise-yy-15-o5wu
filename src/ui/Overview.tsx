import { buildOverview, evaluateBatch, formatMpm } from "../domain/rules";
import { formatPercent } from "./time";
import { ConsoleProps } from "./types";

export default function Overview({ data }: ConsoleProps) {
  const stats = buildOverview(data);
  const cards = [
    { label: "鸽棚羽数", value: String(stats.pigeonCount), sub: `${stats.bloodlineCount} 个血统` },
    { label: "未结束批次", value: String(stats.openBatchCount), sub: `已结束 ${stats.closedBatchCount}` },
    { label: "排行中记录", value: String(stats.rankedCount), sub: `共 ${stats.entryCount} 条登记` },
    { label: "总归巢率", value: formatPercent(stats.returnRate), sub: "已作废不计入" },
    { label: "排行均分速", value: stats.avgSpeedMpm === null ? "—" : `${stats.avgSpeedMpm.toFixed(0)} m/min`, sub: "全部批次有效羽" },
    { label: "待办", value: String(stats.heldCount + stats.disputedCount + stats.noreturnCount), sub: `${stats.heldCount} 待复核 · ${stats.disputedCount} 争议 · ${stats.noreturnCount} 未归巢` },
  ];

  const open = data.batches.filter((b) => b.status === "open");

  return (
    <div className="overview">
      <div className="metrics">
        {cards.map((c) => (
          <article key={c.label}>
            <small>{c.label}</small>
            <strong>{c.value}</strong>
            <span>{c.sub}</span>
          </article>
        ))}
      </div>

      <section className="panel">
        <h2>未归巢提醒（仅未结束批次）</h2>
        {open.length === 0 && <p className="muted">当前没有未结束批次。</p>}
        {open.map((b) => {
          const ev = evaluateBatch(
            b,
            data.entries.filter((e) => e.batchId === b.id),
          );
          return (
            <div key={b.id} className="reminder-block">
              <header>
                <b>{b.code}</b>
                <span className="muted">{b.site} · {b.distanceMeters === null ? "缺航距" : `${b.distanceMeters / 1000}km`}</span>
                <span className={ev.noreturn.length ? "alert-text" : "ok-text"}>
                  {ev.noreturn.length ? `${ev.noreturn.length} 羽未归巢` : "全部报时"}
                </span>
              </header>
              {ev.noreturn.length > 0 && (
                <ul className="reminder-list">
                  {ev.noreturn.map((e) => {
                    const p = data.pigeons.find((x) => x.ringNo === e.entry.ringNo);
                    return (
                      <li key={e.entry.id}>
                        {e.entry.ringNo}
                        <small>{p?.bloodline ?? ""}</small>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel">
        <h2>各批次结论（与核验台同源重算）</h2>
        <div className="table-wrap">
          <table className="entry-table">
            <thead>
              <tr>
                <th>批次</th><th>状态</th><th>排行</th><th>待复核</th><th>争议</th><th>未归巢</th><th>归巢率</th><th>均分速</th><th>留档次数</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => {
                const ev = evaluateBatch(
                  b,
                  data.entries.filter((e) => e.batchId === b.id),
                );
                return (
                  <tr key={b.id}>
                    <td><b>{b.code}</b><small>{b.site}</small></td>
                    <td>{b.status === "open" ? "未结束" : "已结束"}</td>
                    <td>{ev.ranked.length}</td>
                    <td>{ev.held.length}</td>
                    <td>{ev.disputed.length}</td>
                    <td>{ev.noreturn.length}</td>
                    <td>{formatPercent(ev.returnRate)}</td>
                    <td>{formatMpm(ev.avgSpeedMpm)}</td>
                    <td>{b.archivedSnapshots.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
