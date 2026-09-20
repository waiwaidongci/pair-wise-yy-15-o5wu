import { useState } from "react";
import "./styles.css";
import { useLoft } from "./ui/useLoft";
import { DeskTab } from "./ui/DeskTab";
import { LoftTab } from "./ui/LoftTab";
import { PigeonProfileTab } from "./ui/PigeonProfileTab";
import { HistoryTab } from "./ui/HistoryTab";
import { ArchiveTab } from "./ui/ArchiveTab";
import { MAX_SPEED_MPM, MIN_SPEED_MPM, TIME_TOLERANCE_SEC } from "./domain/rules";

type Tab = "desk" | "loft" | "profile" | "history" | "archive";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "desk", label: "批次核验台" },
  { key: "loft", label: "鸽棚总览" },
  { key: "profile", label: "单羽档案" },
  { key: "history", label: "历史成绩" },
  { key: "archive", label: "参数留档" },
];

function App() {
  const loft = useLoft();
  const [tab, setTab] = useState<Tab>("desk");
  const [focusRing, setFocusRing] = useState<string | null>(null);
  const [focusBatchForArchive, setFocusBatchForArchive] = useState<string | null>(null);

  function openPigeon(ring: string) {
    setFocusRing(ring);
    setTab("profile");
  }

  return (
    <main className="app">
      <header className="hero">
        <p>hxyfront-62014 · 赛鸽训放 · 批次核验台</p>
        <h1>赛鸽训放批次核验台</h1>
        <span>
          规则 / 存储 / 页面三层分离：同一未结束批次每羽仅可上笼一次，冲突提交返回 409 且不落库；
          放飞参数与归巢报时须齐全，报时不一致保留双方原值由另一人复核；
          改动放飞参数后，排行与未归巢提醒按新值重算，旧结论自动留档。
        </span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab active" : "tab"}
            onClick={() => {
              if (t.key === "archive") setFocusBatchForArchive(null);
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          className="tab reset"
          onClick={() => {
            if (window.confirm("重置为内置演示数据？当前全部改动会被清除。")) {
              void loft.resetDemo();
            }
          }}
        >
          重置演示数据
        </button>
      </nav>

      <aside className="rules-card">
        <strong>核验规则</strong>
        <ul>
          <li>同一未结束批次重复登记 / 重复报时 → <b>409 冲突，不落库</b></li>
          <li>放飞参数（地点、放飞时间）或归巢报时不齐全 → 不进排行</li>
          <li>归巢早于放飞、缺航距、速度超出 {MIN_SPEED_MPM}–{MAX_SPEED_MPM} m/min → 只留待复核</li>
          <li>鸽主与传感器报时差异 &gt; {TIME_TOLERANCE_SEC} 秒 → 双方原值保留，另一人复核</li>
          <li>复核人不得是登记人 / 报时人本人</li>
        </ul>
      </aside>

      {!loft.ready ? (
        <section className="panel"><p className="empty-note">正在载入鸽棚数据…</p></section>
      ) : (
        <>
          {tab === "desk" && (
            <DeskTab
              loft={loft}
              pushToast={loft.pushToast}
              onOpenArchive={(batchId) => {
                setFocusBatchForArchive(batchId ?? null);
                setTab("archive");
              }}
            />
          )}
          {tab === "loft" && (
            <LoftTab loft={loft} pushToast={loft.pushToast} onOpenPigeon={openPigeon} />
          )}
          {tab === "profile" && (
            <PigeonProfileTab
              key={focusRing ?? "none"}
              ring={focusRing}
              pigeons={loft.pigeons}
              batches={loft.batches}
              entries={loft.entries}
              pushToast={loft.pushToast}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              pigeons={loft.pigeons}
              batches={loft.batches}
              entries={loft.entries}
              onOpenPigeon={openPigeon}
            />
          )}
          {tab === "archive" && (
            <ArchiveTab
              db={{ archives: loft.archives, batches: loft.batches }}
              focusBatchId={focusBatchForArchive}
            />
          )}
        </>
      )}

      <div className="toast-stack">
        {loft.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === "ok" ? "toast-ok" : "toast-error"}`}
            onClick={() => loft.dismissToast(t.id)}
          >
            {t.status ? <b>{t.status}</b> : null}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
