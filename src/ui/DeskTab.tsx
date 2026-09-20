import { useMemo, useState } from "react";
import {
  FLAG_TEXT,
  TIME_TOLERANCE_SEC,
  batchStats,
  distanceBand,
  evaluateBatch,
  notReturned,
  ranking,
} from "../domain/rules";
import type { Batch, Entry, EntryView, FlagCode } from "../domain/types";
import { repository, type RepoResult } from "../storage/repository";
import {
  fmtClock,
  fmtDateTime,
  fmtDistance,
  fmtMin,
  fmtSpeed,
  toLocalInput,
  toLocalInputSec,
} from "../lib/format";
import type { LoftState } from "./useLoft";
import { EmptyNote, Field, FlagBadges, Panel, ResultBanner, StatusBadge } from "./components";

type AnyResult = RepoResult<unknown> | null;

export function DeskTab({
  loft,
  pushToast,
  onOpenArchive,
}: {
  loft: LoftState;
  pushToast: (t: { kind: "ok" | "error"; status?: number; message: string }) => void;
  onOpenArchive: (batchId?: string) => void;
}) {
  const openBatches = loft.batches.filter((b) => b.status === "open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const batch: Batch | undefined =
    loft.batches.find((b) => b.id === selectedId) ?? openBatches[0] ?? loft.batches[0];

  const entries = batch ? loft.entries.filter((e) => e.batchId === batch.id) : [];
  const views = useMemo(
    () => (batch ? evaluateBatch(loft.entries, batch) : new Map<string, EntryView>()),
    [loft.entries, batch]
  );
  const rows = useMemo(
    () => (batch ? ranking(loft.entries, batch) : []),
    [loft.entries, batch]
  );
  const missing = useMemo(
    () => (batch ? notReturned(loft.entries, batch) : []),
    [loft.entries, batch]
  );
  const stats = useMemo(
    () => (batch ? batchStats(loft.entries, batch) : null),
    [loft.entries, batch]
  );
  const reviewViews = [...views.values()].filter((v) => v.status === "review");

  const [error, setError] = useState<AnyResult>(null);

  async function run<T>(res: Promise<RepoResult<T>>, okMessage: string): Promise<boolean> {
    const r = await res;
    if (r.ok) {
      setError(null);
      pushToast({ kind: "ok", status: r.status, message: okMessage });
      return true;
    }
    setError(r);
    pushToast({ kind: "error", status: r.status, message: r.message });
    return false;
  }

  if (!batch) {
    return (
      <Panel title="批次核验台" hint="尚未创建批次">
        <EmptyNote>还没有任何训放批次，请先创建一个批次。</EmptyNote>
        <CreateBatchForm run={run} />
      </Panel>
    );
  }

  const reportedRings = new Set(
    entries.filter((e) => e.ownerTime != null || e.sensorTime != null).map((e) => e.ring)
  );
  const registeredRings = new Set(entries.map((e) => e.ring));

  return (
    <div className="desk">
      <Panel
        title="批次核验台"
        hint="同一未结束批次每羽仅可登记一次 · 冲突提交 409 不落库"
        actions={
          <>
            <select
              value={batch.id}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="选择批次"
            >
              {loft.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.status === "open" ? "🟢 " : "⚪ "}
                  {b.name}（{b.location}）
                </option>
              ))}
            </select>
            <button onClick={() => onOpenArchive(batch.id)}>
              参数改动留档（{loft.archives.filter((a) => a.batchId === batch.id).length}）
            </button>
          </>
        }
      >
        <div className="batch-meta">
          <div>
            <span className="meta-label">批次状态</span>
            <strong>{batch.status === "open" ? "未结束" : "已结束"}</strong>
          </div>
          <div>
            <span className="meta-label">放飞时间</span>
            <strong>{fmtDateTime(batch.releaseTime)}</strong>
          </div>
          <div>
            <span className="meta-label">训放地点</span>
            <strong>{batch.location}</strong>
          </div>
          <div>
            <span className="meta-label">航距 / 分级</span>
            <strong>
              {fmtDistance(batch.distanceM)} · {distanceBand(batch.distanceM)}
            </strong>
          </div>
          <div>
            <span className="meta-label">天气</span>
            <strong>{batch.weather || "—"}</strong>
          </div>
        </div>

        {stats ? (
          <div className="stat-strip">
            <span><b>{stats.registered}</b> 上笼</span>
            <span><b>{stats.valid}</b> 已核验上榜</span>
            <span className="stat-warn"><b>{stats.review}</b> 待复核</span>
            <span className="stat-warn"><b>{stats.notReturned}</b> 未归巢</span>
            <span><b>{stats.voidCount}</b> 复核无效</span>
            <span><b>{stats.returnRate ?? "—"}%</b> 归巢率</span>
            <span><b>{fmtSpeed(stats.avgSpeed)}</b> 平均速度</span>
          </div>
        ) : null}

        <ResultBanner result={error} />

        {batch.status === "open" ? (
          <CloseBatchButton key={batch.id} batch={batch} run={run} />
        ) : null}

        <details className="inline-form">
          <summary>＋ 新建训放批次（设置放飞参数）</summary>
          <CreateBatchForm run={run} onCreated={(id) => setSelectedId(id)} />
        </details>
      </Panel>

      <div className="desk-grid">
        <Panel title="上笼登记" hint="冲突时返回 409，记录不落库">
          <RegisterForm
            key={`reg-${batch.id}`}
            batch={batch}
            pigeons={loft.pigeons}
            registeredRings={registeredRings}
            run={run}
          />
        </Panel>

        <Panel
          title="归巢报时"
          hint={`鸽主与传感器两路原值都保留；差异 > ${TIME_TOLERANCE_SEC} 秒转复核队列`}
        >
          <ReportForm
            key={`rep-${batch.id}`}
            batch={batch}
            entries={entries}
            reportedRings={reportedRings}
            run={run}
          />
        </Panel>

        <Panel title="放飞参数" hint="改动后排行/提醒按新值重算，旧结论自动留档">
          <ReleaseParamsForm
            key={`rel-${batch.id}`}
            batch={batch}
            run={run}
            onOpenArchive={() => onOpenArchive(batch.id)}
          />
        </Panel>
      </div>

      <Panel
        title="复核队列"
        hint={`${reviewViews.length} 羽待复核 · 复核人必须不是登记人/报时人`}
      >
        {reviewViews.length === 0 ? (
          <EmptyNote>没有待复核记录。报时不一致、早于放飞、缺航距、速度越界都会进入这里。</EmptyNote>
        ) : (
          <div className="review-list">
            {reviewViews.map((v) => (
              <ReviewCard key={v.entry.id} view={v} batch={batch} run={run} />
            ))}
          </div>
        )}
      </Panel>

      <div className="desk-grid desk-grid-2">
        <Panel title="归巢排行" hint="仅核验通过者，按分速降序">
          {rows.length === 0 ? (
            <EmptyNote>暂无核验通过的记录。</EmptyNote>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>名次</th><th>足环号</th><th>归巢时间</th><th>分速</th><th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entry.id}>
                    <td className="rank-cell">#{r.rank}</td>
                    <td>{r.ring}</td>
                    <td>{fmtClock(r.arrivalTime)}</td>
                    <td>{fmtSpeed(r.speedMpm)}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title={batch.status === "open" ? "未归巢提醒" : "未归巢归档"}
          hint={batch.status === "open" ? "已上笼但两路都未报时" : "批次结束时仍无任何归巢报时"}
        >
          {missing.length === 0 ? (
            <EmptyNote>全部上笼鸽均已有报时（异常报时见复核队列）。</EmptyNote>
          ) : (
            <ul className="missing-list">
              {missing.map((v) => (
                <li key={v.entry.id}>
                  <span className="missing-ring">{v.ring}</span>
                  <span>上笼于 {fmtDateTime(v.entry.registeredAt)}，登记人 {v.entry.registrar}</span>
                  <StatusBadge status={v.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="本批次全部上笼记录" hint="列表 / 统计 / 排行均由同一规则实时推导">
        <table className="data-table wide">
          <thead>
            <tr>
              <th>足环号</th>
              <th>鸽主报时</th>
              <th>传感器报时</th>
              <th>差异</th>
              <th>认定归巢</th>
              <th>分速</th>
              <th>状态 / 待复核原因</th>
              <th>复核人</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const v = views.get(e.id)!;
              return (
                <tr key={e.id}>
                  <td>{e.ring}</td>
                  <td className="raw-time">{fmtClock(e.ownerTime)}</td>
                  <td className="raw-time">{fmtClock(e.sensorTime)}</td>
                  <td>{fmtMin(v.discrepancyMin)}</td>
                  <td className="raw-time">{fmtClock(v.arrivalTime)}</td>
                  <td>{fmtSpeed(v.speedMpm)}</td>
                  <td>
                    <StatusBadge status={v.status} /> <FlagBadges flags={v.flags} />
                  </td>
                  <td>{e.reviewer ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

type RunFn = <T>(res: Promise<RepoResult<T>>, okMessage: string) => Promise<boolean>;

function CreateBatchForm({
  run,
  onCreated,
}: {
  run: RunFn;
  onCreated?: (id: string) => void;
}) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultRelease = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(
    today.getDate()
  )}T07:30`;
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [releaseTime, setReleaseTime] = useState(defaultRelease);
  const [distanceKm, setDistanceKm] = useState("");
  const [weather, setWeather] = useState("");

  return (
    <div className="form-grid">
      <Field label="批次名称（可留空自动生成）">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：周末加站 120km" />
      </Field>
      <Field label="训放地点 *">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如：北河开笼点" />
      </Field>
      <Field label="放飞时间 *">
        <input type="datetime-local" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value)} />
      </Field>
      <Field label="放飞航距（公里，可留空待补录）" hint="缺航距时归巢报时只能待复核，不能进排行">
        <input
          inputMode="decimal"
          value={distanceKm}
          onChange={(e) => setDistanceKm(e.target.value)}
          placeholder="如：80"
        />
      </Field>
      <Field label="天气">
        <input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="晴 / 多云 / 逆风…" />
      </Field>
      <div className="form-action">
        <button
          className="primary"
          onClick={async () => {
            const km = distanceKm.trim() === "" ? null : Number(distanceKm);
            const ok = await run(
              repository.createBatch({
                name: name || undefined,
                location,
                releaseTime,
                distanceM: km == null ? null : Math.round(km * 1000),
                weather,
              }),
              "批次已创建"
            );
            if (ok) {
              setName("");
              setLocation("");
              setDistanceKm("");
              setWeather("");
              // 存储层广播会刷新列表；拿到新批次 id 需要一次拉取
              const snap = await repository.list();
              const newest = snap.batches.find(
                (b) => b.location === location.trim() && b.releaseTime === releaseTime
              );
              if (newest && onCreated) onCreated(newest.id);
            }
          }}
        >
          创建批次
        </button>
      </div>
    </div>
  );
}

function CloseBatchButton({ batch, run }: { batch: Batch; run: RunFn }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button className="ghost-danger" onClick={() => setConfirming(true)}>
        结束批次「{batch.name}」
      </button>
    );
  }
  return (
    <div className="confirm-row">
      <span>结束后不能再登记或报时，确定结束该批次？</span>
      <button
        className="primary danger"
        onClick={async () => {
          await run(repository.closeBatch(batch.id), "批次已结束");
          setConfirming(false);
        }}
      >
        确认结束
      </button>
      <button onClick={() => setConfirming(false)}>取消</button>
    </div>
  );
}

function RegisterForm({
  batch,
  pigeons,
  registeredRings,
  run,
}: {
  batch: Batch;
  pigeons: LoftState["pigeons"];
  registeredRings: Set<string>;
  run: RunFn;
}) {
  const available = pigeons.filter((p) => !registeredRings.has(p.ring));
  const [ring, setRing] = useState("");
  const [registrar, setRegistrar] = useState("");

  if (batch.status !== "open") {
    return <EmptyNote>批次已结束，登记通道关闭。</EmptyNote>;
  }

  return (
    <div className="form-grid single">
      <Field label="选择赛鸽（足环号）*">
        {available.length === 0 ? (
          <input disabled value="鸽棚赛鸽均已在本批次登记" readOnly />
        ) : (
          <select value={ring} onChange={(e) => setRing(e.target.value)}>
            <option value="">请选择…</option>
            {available.map((p) => (
              <option key={p.ring} value={p.ring}>
                {p.ring}（{p.bloodline}）
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="登记人 *">
        <input value={registrar} onChange={(e) => setRegistrar(e.target.value)} placeholder="如：鸽主老陈" />
      </Field>
      <div className="form-action">
        <button
          className="primary"
          disabled={!ring}
          onClick={async () => {
            const ok = await run(repository.register(batch.id, ring, registrar), `${ring} 上笼登记成功`);
            if (ok) {
              setRing("");
              setRegistrar("");
            }
          }}
        >
          提交上笼登记
        </button>
      </div>
    </div>
  );
}

function ReportForm({
  batch,
  entries,
  reportedRings,
  run,
}: {
  batch: Batch;
  entries: Entry[];
  reportedRings: Set<string>;
  run: RunFn;
}) {
  const pending = entries.filter((e) => !reportedRings.has(e.ring));
  const [ring, setRing] = useState("");
  const [reporter, setReporter] = useState("");
  const [ownerTime, setOwnerTime] = useState("");
  const [sensorTime, setSensorTime] = useState("");

  if (batch.status !== "open") {
    return <EmptyNote>批次已结束，报时通道关闭。</EmptyNote>;
  }

  return (
    <div className="form-grid">
      <Field label="已上笼未报时的赛鸽 *">
        {pending.length === 0 ? (
          <input disabled value="本批次已无待报时赛鸽" readOnly />
        ) : (
          <select value={ring} onChange={(e) => setRing(e.target.value)}>
            <option value="">请选择…</option>
            {pending.map((e) => (
              <option key={e.id} value={e.ring}>{e.ring}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="报时人 *">
        <input value={reporter} onChange={(e) => setReporter(e.target.value)} placeholder="如：助手小王" />
      </Field>
      <Field label="鸽主报归巢时间" hint="只填一路会落库为“待复核”，原值保留">
        <input type="datetime-local" step="1" value={ownerTime} onChange={(e) => setOwnerTime(e.target.value)} />
      </Field>
      <Field label="传感器报归巢时间">
        <input type="datetime-local" step="1" value={sensorTime} onChange={(e) => setSensorTime(e.target.value)} />
      </Field>
      <div className="form-action span-2">
        <button
          className="primary"
          disabled={!ring || (!ownerTime && !sensorTime)}
          onClick={async () => {
            const ok = await run(
              repository.report(batch.id, ring, reporter, {
                ownerTime: ownerTime || null,
                sensorTime: sensorTime || null,
              }),
              `${ring} 归巢报时已提交`
            );
            if (ok) {
              setRing("");
              setOwnerTime("");
              setSensorTime("");
            }
          }}
        >
          提交归巢报时
        </button>
      </div>
    </div>
  );
}

function ReleaseParamsForm({
  batch,
  run,
  onOpenArchive,
}: {
  batch: Batch;
  run: RunFn;
  onOpenArchive: () => void;
}) {
  const [location, setLocation] = useState(batch.location);
  const [releaseTime, setReleaseTime] = useState(toLocalInput(batch.releaseTime));
  const [distanceKm, setDistanceKm] = useState(
    batch.distanceM == null ? "" : String(batch.distanceM / 1000)
  );
  const [weather, setWeather] = useState(batch.weather);
  const [editor, setEditor] = useState("");

  const changed =
    location !== batch.location ||
    releaseTime !== toLocalInput(batch.releaseTime) ||
    (batch.distanceM == null ? distanceKm.trim() !== "" : distanceKm !== String(batch.distanceM / 1000)) ||
    weather !== batch.weather;

  return (
    <div className="form-grid">
      <Field label="训放地点">
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <Field label="放飞时间">
        <input type="datetime-local" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value)} />
      </Field>
      <Field label="航距（公里，清空=待补录）">
        <input inputMode="decimal" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} />
      </Field>
      <Field label="天气">
        <input value={weather} onChange={(e) => setWeather(e.target.value)} />
      </Field>
      <Field label="修改操作人 *">
        <input value={editor} onChange={(e) => setEditor(e.target.value)} placeholder="留档责任人" />
      </Field>
      <div className="form-action span-2">
        <button
          className="primary"
          disabled={!changed || !editor.trim()}
          onClick={async () => {
            const km = distanceKm.trim() === "" ? null : Number(distanceKm);
            const ok = await run(
              repository.updateReleaseParams(
                batch.id,
                editor,
                {
                  location,
                  releaseTime,
                  distanceM: km == null || Number.isNaN(km) ? null : Math.round(km * 1000),
                  weather,
                }
              ),
              "放飞参数已更新：排行与未归巢提醒按新值重算，旧结论已留档"
            );
            if (ok) setEditor("");
          }}
        >
          保存并留档重算
        </button>
        <button className="link-btn" onClick={onOpenArchive}>查看本批次留档</button>
      </div>
    </div>
  );
}

function ReviewCard({ view, batch, run }: { view: EntryView; batch: Batch; run: RunFn }) {
  const e = view.entry;
  const parties = [e.registrar, e.reporter].filter(Boolean).join("、");
  const initial = e.adjudicatedTime
    ? toLocalInputSec(e.adjudicatedTime)
    : toLocalInputSec(e.sensorTime ?? e.ownerTime);
  const [reviewer, setReviewer] = useState("");
  const [adjudicated, setAdjudicated] = useState(initial);
  const [note, setNote] = useState(e.reviewNote ?? "");

  return (
    <article className="review-card">
      <div className="review-head">
        <strong>{e.ring}</strong>
        <FlagBadges flags={view.flags} />
        <span className="review-parties">相关当事人：{parties || "—"}（不可复核）</span>
      </div>
      <div className="review-times">
        <div>
          <span>鸽主原值</span>
          <b>{fmtClock(e.ownerTime)}</b>
        </div>
        <div>
          <span>传感器原值</span>
          <b>{fmtClock(e.sensorTime)}</b>
        </div>
        <div>
          <span>当前差异</span>
          <b>{fmtMin(view.discrepancyMin)}</b>
        </div>
        {view.flags.map((f) => (
          <div key={f} className="review-detail">
            <span>{FLAG_TEXT[f]}</span>
            <b>{detailFor(f, view, batch)}</b>
          </div>
        ))}
      </div>
      <div className="review-form">
        <input
          placeholder="复核人（须为另一人）*"
          value={reviewer}
          onChange={(ev) => setReviewer(ev.target.value)}
        />
        <input
          type="datetime-local"
          step="1"
          aria-label="认定归巢时间"
          value={adjudicated}
          onChange={(ev) => setAdjudicated(ev.target.value)}
        />
        <input
          placeholder="复核备注（可选）"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
        />
        <button
          className="primary"
          disabled={!reviewer.trim() || !adjudicated}
          title="人工采信后仍会按当前放飞参数重新校验，合格才进排行"
          onClick={async () => {
            const ok = await run(
              repository.review(e.id, reviewer, {
                action: "accept",
                adjudicatedTime: adjudicated,
                note,
              }),
              `${e.ring} 复核通过`
            );
            if (ok) setReviewer("");
          }}
        >
          接受此归巢时间
        </button>
        <button
          className="ghost-danger"
          disabled={!reviewer.trim()}
          onClick={async () => {
            const ok = await run(
              repository.review(e.id, reviewer, { action: "void", note }),
              `${e.ring} 已判定无效，不进入排行`
            );
            if (ok) setReviewer("");
          }}
        >
          判无效
        </button>
      </div>
      {e.verdict ? (
        <p className="review-history">
          已有结论：{e.verdict === "accepted" ? "接受" : "无效"} · 复核人 {e.reviewer} ·{" "}
          {fmtDateTime(e.reviewedAt)}
          {e.reviewNote ? ` · ${e.reviewNote}` : ""}
        </p>
      ) : null}
    </article>
  );
}

function detailFor(f: FlagCode, v: EntryView, batch: Batch): string {
  switch (f) {
    case "time-conflict":
      return `双方相差 ${fmtMin(v.discrepancyMin)}`;
    case "missing-times":
      return "鸽主或传感器缺报";
    case "early":
      return `放飞 ${fmtDateTime(batch.releaseTime)}`;
    case "no-distance":
      return "批次航距待补录";
    case "speed-out":
      return `合理区间 400–1700 m/min`;
  }
}
