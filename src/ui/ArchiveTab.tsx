import { useState } from "react";
import { STATUS_TEXT } from "../domain/rules";
import { fmtDateTime, fmtDistance, fmtSpeed } from "../lib/format";
import type { Database, ParamArchive } from "../domain/types";
import { Panel } from "./components";

/** 参数改动留档：每次改动放飞参数前的旧结论快照 + 参数前后对照 */
export function ArchiveTab({
  db,
  focusBatchId,
}: {
  db: Pick<Database, "archives" | "batches">;
  focusBatchId?: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(focusBatchId ? null : null);
  const list = focusBatchId
    ? db.archives.filter((a) => a.batchId === focusBatchId)
    : db.archives;
  const batchName = (id: string) => db.batches.find((b) => b.id === id)?.name ?? "已删除批次";

  return (
    <Panel
      title="放飞参数改动留档"
      hint={focusBatchId ? "当前批次的参数改动记录" : "旧结论只留档，不回写排行"}
    >
      {list.length === 0 ? (
        <p className="empty-note">
          暂无改动。修改任一批次的放飞时间 / 航距 / 地点 / 天气时，系统会先把当时每羽的状态、
          分速和待复核原因快照到这里，再让排行与未归巢提醒按新值重算。
        </p>
      ) : (
        <div className="archive-list">
          {list.map((a) => (
            <ArchiveItem
              key={a.id}
              archive={a}
              batchLabel={batchName(a.batchId)}
              open={expanded === a.id}
              onToggle={() => setExpanded((cur) => (cur === a.id ? null : a.id))}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function ArchiveItem({
  archive,
  batchLabel,
  open,
  onToggle,
}: {
  archive: ParamArchive;
  batchLabel: string;
  open: boolean;
  onToggle: () => void;
}) {
  const a = archive;
  return (
    <article className="archive-item">
      <button className="archive-head" onClick={onToggle}>
        <div>
          <strong>{batchLabel}</strong>
          <span>
            {fmtDateTime(a.changedAt)} · 操作人 {a.editor}
          </span>
        </div>
        <span className="archive-toggle">{open ? "收起 ▲" : "展开旧结论 ▼"}</span>
      </button>

      <div className="param-diff">
        <div>
          <span>参数</span><span>改动前</span><span>改动后</span>
        </div>
        <DiffRow label="放飞时间" before={fmtDateTime(a.before.releaseTime)} after={fmtDateTime(a.after.releaseTime)} />
        <DiffRow label="航距" before={fmtDistance(a.before.distanceM)} after={fmtDistance(a.after.distanceM)} />
        <DiffRow label="地点" before={a.before.location} after={a.after.location} />
        <DiffRow label="天气" before={a.before.weather || "—"} after={a.after.weather || "—"} />
      </div>

      {open ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>足环号</th><th>改动前状态</th><th>改动前分速</th><th>改动前待复核原因</th>
            </tr>
          </thead>
          <tbody>
            {a.conclusions.map((c) => (
              <tr key={c.entryId}>
                <td>{c.ring}</td>
                <td>{STATUS_TEXT[c.status]}</td>
                <td>{fmtSpeed(c.speedMpm)}</td>
                <td>{c.flags.length === 0 ? "—" : c.flags.join("、")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after;
  return (
    <div className={changed ? "diff-changed" : ""}>
      <span>{label}</span>
      <span className="diff-before">{before}</span>
      <span className="diff-after">{after}{changed ? " ← 已重算" : ""}</span>
    </div>
  );
}
