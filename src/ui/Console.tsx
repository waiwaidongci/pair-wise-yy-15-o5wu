import { useMemo, useState } from "react";
import {
  BatchEvaluation,
  Entry,
  EntryState,
  EvaluatedEntry,
  ReleaseBatch,
  ReviewDecision,
} from "../domain/types";
import {
  evaluateBatch,
  formatDuration,
  formatMpm,
  STATE_LABEL,
} from "../domain/rules";
import {
  NewBatchInput,
  ReleaseParamsInput,
  StoreError,
  store,
} from "../storage/store";
import { formatDateTime, formatPercent, nowLocalInput, toLocalInput } from "./time";
import { ConsoleProps } from "./types";


const STATE_CLASS: Record<EntryState, string> = {
  ranked: "tag tag-ranked",
  held: "tag tag-held",
  disputed: "tag tag-disputed",
  noreturn: "tag tag-noreturn",
  void: "tag tag-void",
};

function entryPigeon(data: ConsoleProps["data"], ringNo: string) {
  return data.pigeons.find((p) => p.ringNo === ringNo);
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="banner banner-error">{message}</div>;
}

function OkBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="banner banner-ok">{message}</div>;
}

function BatchList({
  data,
  selectedId,
  onSelect,
}: {
  data: ConsoleProps["data"];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const batches = [...data.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="batch-list">
      {batches.map((b) => {
        const ev = evaluateBatch(
          b,
          data.entries.filter((e) => e.batchId === b.id),
        );
        return (
          <button
            key={b.id}
            className={`batch-item${b.id === selectedId ? " active" : ""}`}
            onClick={() => onSelect(b.id)}
          >
            <span className="batch-code">{b.code}</span>
            <span className={`dot ${b.status}`}>{b.status === "open" ? "未结束" : "已结束"}</span>
            <span className="batch-meta">
              {ev.ranked.length} 排行 · {ev.noreturn.length} 未归巢 · {ev.disputed.length} 争议
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CreateBatchForm({ operatorId, onDone }: { operatorId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    code: "",
    site: "",
    distanceText: "",
    releasedAt: nowLocalInput(),
    weather: "",
  });
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const input: NewBatchInput = {
        code: form.code,
        site: form.site,
        distanceMeters: form.distanceText.trim() ? Number(form.distanceText) * 1000 : null,
        releasedAt: form.releasedAt,
        weather: form.weather,
        operatorId,
      };
      const batch = await store.createBatch(input);
      setForm({ code: "", site: "", distanceText: "", releasedAt: nowLocalInput(), weather: "" });
      onDone();
      void batch;
    } catch (err) {
      setError(err instanceof StoreError ? err.message : "创建失败");
    }
  }

  return (
    <div className="subform">
      <h3>新建批次</h3>
      <ErrorBanner message={error} />
      <div className="form-row">
        <label>
          <span>批次编号</span>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="B-0921-01" />
        </label>
        <label>
          <span>训放地点</span>
          <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="东线 120km 司放点" />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>放飞时间</span>
          <input type="datetime-local" value={form.releasedAt} onChange={(e) => setForm({ ...form, releasedAt: e.target.value })} />
        </label>
        <label>
          <span>放飞航距（公里，可后补）</span>
          <input inputMode="decimal" value={form.distanceText} onChange={(e) => setForm({ ...form, distanceText: e.target.value })} placeholder="如 120" />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>天气</span>
          <input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} placeholder="晴 / 侧风" />
        </label>
        <button className="primary" onClick={submit}>开立批次</button>
      </div>
    </div>
  );
}

function ParamsEditor({
  batch,
  operatorId,
}: {
  batch: ReleaseBatch;
  operatorId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    site: batch.site,
    distanceText: batch.distanceMeters === null ? "" : String(batch.distanceMeters / 1000),
    releasedAt: toLocalInput(batch.releasedAt),
    weather: batch.weather,
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function start() {
    setForm({
      site: batch.site,
      distanceText: batch.distanceMeters === null ? "" : String(batch.distanceMeters / 1000),
      releasedAt: toLocalInput(batch.releasedAt),
      weather: batch.weather,
    });
    setEditing(true);
    setError(null);
    setOk(null);
  }

  async function save() {
    setError(null);
    if (!reason.trim()) {
      setError("改动放飞参数必须填写修订原因，旧结论将留档");
      return;
    }
    try {
      const params: ReleaseParamsInput = {
        site: form.site,
        distanceMeters: form.distanceText.trim() ? Number(form.distanceText) * 1000 : null,
        releasedAt: form.releasedAt,
        weather: form.weather,
      };
      await store.updateReleaseParams(batch.id, params, operatorId, reason);
      setEditing(false);
      setReason("");
      setOk("参数已更新，排行与未归巢提醒按新值重算；旧结论已留档");
    } catch (err) {
      setError(err instanceof StoreError ? err.message : "保存失败");
    }
  }

  return (
    <div className="panel-inner">
      <div className="heading-row">
        <h3>放飞参数</h3>
        {!editing && <button onClick={start}>修订参数</button>}
      </div>
      <OkBanner message={ok} />
      <dl className="kv">
        <dt>司放地点</dt><dd>{batch.site}</dd>
        <dt>放飞时间</dt><dd>{formatDateTime(batch.releasedAt)}</dd>
        <dt>放飞航距</dt><dd>{batch.distanceMeters === null ? <em>缺失（有报时羽先留待复核）</em> : `${(batch.distanceMeters / 1000).toFixed(2)} km`}</dd>
        <dt>天气</dt><dd>{batch.weather || "—"}</dd>
      </dl>

      {editing && (
        <div className="subform edit-box">
          <ErrorBanner message={error} />
          <div className="form-row">
            <label>
              <span>司放地点</span>
              <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
            </label>
            <label>
              <span>放飞时间</span>
              <input type="datetime-local" value={form.releasedAt} onChange={(e) => setForm({ ...form, releasedAt: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>
              <span>放飞航距（公里，留空即缺航距）</span>
              <input inputMode="decimal" value={form.distanceText} onChange={(e) => setForm({ ...form, distanceText: e.target.value })} />
            </label>
            <label>
              <span>天气</span>
              <input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} />
            </label>
          </div>
          <label className="full">
            <span>修订原因（旧排行与提醒结论将快照留档）</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：勘误航距 118km→120km" />
          </label>
          <div className="actions">
            <button className="primary" onClick={save}>保存并重算</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}

      {batch.archivedSnapshots.length > 0 && (
        <details className="archive">
          <summary>旧结论留档（{batch.archivedSnapshots.length} 次参数修订）</summary>
          {[...batch.archivedSnapshots].reverse().map((s, i) => (
            <div key={i} className="snapshot">
              <header>
                <b>{formatDateTime(s.changedAt)}</b>
                <span>{s.changedBy} 修订 · {s.reason}</span>
              </header>
              <p>
                旧参数：{s.params.site} · {s.params.distanceMeters === null ? "缺航距" : `${s.params.distanceMeters / 1000}km`} · {formatDateTime(s.params.releasedAt)} · {s.params.weather || "—"}
              </p>
              <p>
                旧排行 {s.ranked.length} 羽 · 待复核 {s.heldCount} · 争议 {s.disputedCount} · 未归巢 {s.noreturnCount}
              </p>
              <ol className="snapshot-rank">
                {s.ranked.map((r) => (
                  <li key={r.ringNo}>#{r.rank} {r.ringNo} — {formatMpm(r.speedMpm)}</li>
                ))}
              </ol>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function EntryForm({
  data,
  batch,
  operatorId,
}: {
  data: ConsoleProps["data"];
  batch: ReleaseBatch;
  operatorId: string;
}) {
  const [ringNo, setRingNo] = useState("");
  const [bloodline, setBloodline] = useState("");
  const [ownerAt, setOwnerAt] = useState(nowLocalInput());
  const [sensorAt, setSensorAt] = useState(nowLocalInput());
  const [ownerChecked, setOwnerChecked] = useState(true);
  const [sensorChecked, setSensorChecked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const known = data.pigeons.find((p) => p.ringNo === ringNo.trim().toUpperCase());

  async function submit() {
    setError(null);
    setOk(null);
    try {
      await store.addEntry({
        batchId: batch.id,
        ringNo,
        bloodline: known ? undefined : bloodline,
        ownerReportedAt: ownerChecked ? ownerAt : null,
        sensorReportedAt: sensorChecked ? sensorAt : null,
        recorderId: operatorId,
      });
      setRingNo("");
      setBloodline("");
      setOk(`已登记到批次 ${batch.code}；规则即时核验`);
    } catch (err) {
      // 409 冲突不落库，直接提示
      setError(err instanceof StoreError ? `[${err.status}] ${err.message}` : "登记失败");
    }
  }

  if (batch.status === "closed") {
    return <p className="muted">批次已结束，不再接受登记。</p>;
  }

  return (
    <div className="subform">
      <h3>登记赛鸽（每羽在本未结束批次只能出现一次）</h3>
      <ErrorBanner message={error} />
      <OkBanner message={ok} />
      <div className="form-row">
        <label>
          <span>足环号</span>
          <input value={ringNo} onChange={(e) => setRingNo(e.target.value)} placeholder="CHN-24-001839" list="ring-options" />
          <datalist id="ring-options">
            {data.pigeons.map((p) => <option key={p.ringNo} value={p.ringNo} />)}
          </datalist>
        </label>
        {!known && (
          <label>
            <span>血统（新足环建档）</span>
            <input value={bloodline} onChange={(e) => setBloodline(e.target.value)} placeholder="詹森系" />
          </label>
        )}
      </div>
      <div className="form-row">
        <label className="checkline">
          <input type="checkbox" checked={ownerChecked} onChange={(e) => setOwnerChecked(e.target.checked)} />
          <span>鸽主归巢报时</span>
          <input type="datetime-local" disabled={!ownerChecked} value={ownerAt} onChange={(e) => setOwnerAt(e.target.value)} />
        </label>
        <label className="checkline">
          <input type="checkbox" checked={sensorChecked} onChange={(e) => setSensorChecked(e.target.checked)} />
          <span>传感器归巢报时</span>
          <input type="datetime-local" disabled={!sensorChecked} value={sensorAt} onChange={(e) => setSensorAt(e.target.value)} />
        </label>
      </div>
      <p className="muted">
        双方报时都留空即登记为未归巢；仅填一方亦可提交。双方原值各自保留，不一致时挂争议由另一人复核。
      </p>
      <div className="actions">
        <button className="primary" onClick={submit}>提交核验</button>
      </div>
    </div>
  );
}

function ReportButtons({ ev, source }: { ev: EvaluatedEntry; source: "owner" | "sensor" }) {
  const value = source === "owner" ? ev.entry.ownerReportedAt : ev.entry.sensorReportedAt;
  const [adding, setAdding] = useState(false);
  const [at, setAt] = useState(nowLocalInput());
  const [error, setError] = useState<string | null>(null);

  if (value) return <span className="report-val">{formatDateTime(value)}</span>;

  async function save() {
    setError(null);
    try {
      await store.saveReport(ev.entry.id, source, at);
      setAdding(false);
    } catch (err) {
      setError(err instanceof StoreError ? err.message : "补录失败");
    }
  }

  return (
    <span className="report-add">
      {adding ? (
        <>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          <button onClick={save}>保存</button>
          <button onClick={() => setAdding(false)}>×</button>
          {error && <em className="inline-error">{error}</em>}
        </>
      ) : (
        <button className="link-btn" onClick={() => setAdding(true)}>+ 补录{source === "owner" ? "鸽主" : "传感器"}报时</button>
      )}
    </span>
  );
}

function ReasonCell({ ev }: { ev: EvaluatedEntry }) {
  return (
    <div className="reason-cell">
      {ev.flags.map((f, i) => <span key={i} className="flag">⚠ {f}</span>)}
      {ev.notes.map((n, i) => <span key={i} className="note">{n}</span>)}
      {ev.state === "ranked" && <span className="note">核验通过</span>}
      {ev.state === "void" && ev.entry.review?.note && <span className="note">作废说明：{ev.entry.review.note}</span>}
    </div>
  );
}

function EntryTable({
  rows,
  showRank,
  data,
}: {
  rows: EvaluatedEntry[];
  showRank?: boolean;
  data: ConsoleProps["data"];
}) {
  if (rows.length === 0) return <p className="muted">无记录</p>;
  return (
    <div className="table-wrap">
      <table className="entry-table">
        <thead>
          <tr>
            {showRank && <th>名次</th>}
            <th>足环号 / 血统</th>
            <th>鸽主报时</th>
            <th>传感器报时</th>
            <th>飞行耗时</th>
            <th>分速</th>
            <th>状态 / 核验原因</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ev) => {
            const pigeon = entryPigeon(data, ev.entry.ringNo);
            return (
              <tr key={ev.entry.id} className={`row-${ev.state}`}>
                {showRank && <td className="rank-cell">#{(ev as EvaluatedEntry & { rank?: number }).rank}</td>}
                <td>
                  <b>{ev.entry.ringNo}</b>
                  <small>{pigeon?.bloodline ?? "—"}</small>
                </td>
                <td><ReportButtons ev={ev} source="owner" /></td>
                <td><ReportButtons ev={ev} source="sensor" /></td>
                <td>{formatDuration(ev.durationSec)}</td>
                <td>{formatMpm(ev.speedMpm)}</td>
                <td>
                  <span className={STATE_CLASS[ev.state]}>{STATE_LABEL[ev.state]}</span>
                  <ReasonCell ev={ev} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReviewQueue({
  data,
  evaluation,
  operatorId,
}: {
  data: ConsoleProps["data"];
  evaluation: BatchEvaluation;
  operatorId: string;
}) {
  const pending = [...evaluation.disputed, ...evaluation.held];
  const [reviewerId, setReviewerId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function review(ev: EvaluatedEntry, decision: ReviewDecision) {
    setError(null);
    const id = reviewerId.trim() || operatorId;
    try {
      await store.reviewEntry(ev.entry.id, decision, id, notes[ev.entry.id] ?? "");
      setNotes((n) => ({ ...n, [ev.entry.id]: "" }));
    } catch (err) {
      setError(err instanceof StoreError ? `[${err.status}] ${err.message}` : "复核失败");
    }
  }

  if (pending.length === 0) {
    return (
      <section className="panel-block">
        <h3>待复核队列</h3>
        <p className="muted">没有争议或待复核记录。</p>
      </section>
    );
  }

  return (
    <section className="panel-block queue">
      <h3>待复核队列（{pending.length} 羽）</h3>
      <ErrorBanner message={error} />
      <div className="reviewer-bar">
        <label>
          <span>复核人（必须不同于提交人）</span>
          <input value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} placeholder={operatorId ? `非 ${operatorId} 的另一人` : "填写复核人标识"} />
        </label>
      </div>
      {pending.map((ev) => (
        <div key={ev.entry.id} className={`queue-item row-${ev.state}`}>
          <div className="queue-head">
            <b>{ev.entry.ringNo}</b>
            <span className={STATE_CLASS[ev.state]}>{STATE_LABEL[ev.state]}</span>
            <span className="muted">提交人：{ev.entry.recorderId}</span>
          </div>
          <div className="queue-times">
            <span>鸽主：{formatDateTime(ev.entry.ownerReportedAt)}</span>
            <span>传感器：{formatDateTime(ev.entry.sensorReportedAt)}</span>
          </div>
          <ReasonCell ev={ev} />
          <input
            placeholder="复核备注（可选）"
            value={notes[ev.entry.id] ?? ""}
            onChange={(e) => setNotes((n) => ({ ...n, [ev.entry.id]: e.target.value }))}
          />
          <div className="actions">
            {ev.state === "disputed" && (
              <>
                <button onClick={() => review(ev, "owner")}>采信鸽主报时</button>
                <button onClick={() => review(ev, "sensor")}>采信传感器报时</button>
              </>
            )}
            {ev.state === "held" && (
              <span className="muted">缺航距/参数问题在上方修订放飞参数后会自动重算；确认无效可作废。</span>
            )}
            <button className="danger" onClick={() => review(ev, "void")}>作废（不进排行与统计）</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function BatchDetail({ data, batch, operatorId }: { data: ConsoleProps["data"]; batch: ReleaseBatch; operatorId: string }) {
  const evaluation = useMemo(
    () => evaluateBatch(batch, data.entries.filter((e) => e.batchId === batch.id)),
    [batch, data.entries],
  );

  async function closeBatch() {
    if (window.confirm(`结束批次 ${batch.code}？结束后不能再登记或补录核验。`)) {
      try {
        await store.closeBatch(batch.id);
      } catch (err) {
        window.alert(err instanceof StoreError ? err.message : "操作失败");
      }
    }
  }

  return (
    <div className="batch-detail">
      <div className="detail-head">
        <div>
          <h2>{batch.code}</h2>
          <p>
            <span className={`dot ${batch.status}`}>{batch.status === "open" ? "未结束批次" : "已结束批次"}</span>
            {" · "}建批 {batch.ownerId} · {formatDateTime(batch.createdAt)}
            {batch.closedAt && <> · 结束于 {formatDateTime(batch.closedAt)}</>}
          </p>
        </div>
        {batch.status === "open" && <button className="danger" onClick={closeBatch}>结束批次</button>}
      </div>

      <div className="stat-strip">
        <div className="stat"><small>排行羽数</small><strong>{evaluation.ranked.length}</strong></div>
        <div className="stat"><small>待复核</small><strong className="warn">{evaluation.held.length}</strong></div>
        <div className="stat"><small>报时争议</small><strong className="warn">{evaluation.disputed.length}</strong></div>
        <div className="stat"><small>未归巢</small><strong className="alert">{evaluation.noreturn.length}</strong></div>
        <div className="stat"><small>归巢率</small><strong>{formatPercent(evaluation.returnRate)}</strong></div>
        <div className="stat"><small>排行均分速</small><strong>{evaluation.avgSpeedMpm === null ? "—" : `${evaluation.avgSpeedMpm.toFixed(0)}`}</strong></div>
      </div>

      <ParamsEditor batch={batch} operatorId={operatorId} />

      <section className="panel-block">
        <h3>登记核验</h3>
        <EntryForm data={data} batch={batch} operatorId={operatorId} />
      </section>

      <section className="panel-block">
        <h3>成绩排行{batch.status === "open" && <em className="muted">（未结束批次实时排行）</em>}</h3>
        <EntryTable rows={evaluation.ranked} showRank data={data} />
      </section>

      <ReviewQueue data={data} evaluation={evaluation} operatorId={operatorId} />

      <section className="panel-block">
        <h3>
          未归巢提醒
          {batch.status === "open"
            ? <em className="muted">（批次未结束，持续提醒）</em>
            : <em className="muted">（批次结束时仍无报时，记失格未归）</em>}
        </h3>
        {evaluation.noreturn.length === 0 ? (
          <p className="muted">全部已报时。</p>
        ) : (
          <EntryTable rows={evaluation.noreturn} data={data} />
        )}
      </section>

      {evaluation.voided.length > 0 && (
        <section className="panel-block">
          <h3>已作废（{evaluation.voided.length} 羽，不计归巢率与排行）</h3>
          <EntryTable rows={evaluation.voided} data={data} />
        </section>
      )}
    </div>
  );
}

export default function Console({ data, operatorId }: ConsoleProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    () => data.batches.find((b) => b.status === "open")?.id ?? data.batches[0]?.id ?? null,
  );
  const selected = data.batches.find((b) => b.id === selectedId)
    ?? data.batches.find((b) => b.status === "open")
    ?? data.batches[0]
    ?? null;

  return (
    <div className="console-grid">
      <aside className="panel side">
        <h2>批次核验台</h2>
        <BatchList data={data} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        <CreateBatchForm operatorId={operatorId} onDone={() => undefined} />
      </aside>
      <section className="panel main-col">
        {selected ? (
          <BatchDetail key={selected.id} data={data} batch={selected} operatorId={operatorId} />
        ) : (
          <p className="muted">还没有批次，请先开立一个批次。</p>
        )}
      </section>
    </div>
  );
}
