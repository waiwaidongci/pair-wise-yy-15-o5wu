import { useState } from "react";
import "./styles.css";
import { store } from "./storage/store";
import { useAppData } from "./storage/react";
import Console from "./ui/Console";
import Overview from "./ui/Overview";
import PigeonProfiles from "./ui/PigeonProfiles";

type Tab = "console" | "overview" | "profiles";

const TABS: { key: Tab; label: string }[] = [
  { key: "console", label: "批次核验台" },
  { key: "overview", label: "鸽棚总览" },
  { key: "profiles", label: "单羽档案" },
];

const OPERATOR_KEY = "pigeon-batch-console:operator";

function App() {
  const data = useAppData();
  const [tab, setTab] = useState<Tab>("console");
  const [operatorId, setOperatorId] = useState<string>(
    () => localStorage.getItem(OPERATOR_KEY) ?? "owner-li",
  );
  const [operatorDraft, setOperatorDraft] = useState(operatorId);

  function commitOperator() {
    const v = operatorDraft.trim() || "anonymous";
    setOperatorId(v);
    localStorage.setItem(OPERATOR_KEY, v);
  }

  async function resetDemo() {
    if (window.confirm("重置为演示数据？当前本地改动将被清空。")) {
      await store.resetDemo();
    }
  }

  return (
    <main className="app app-v2">
      <header className="topbar">
        <div className="brand">
          <h1>赛鸽训放 · 批次核验台</h1>
          <p>规则 / 存储 / 页面三层分离 · 冲突 409 不落库 · 参数修订旧结论留档</p>
        </div>
        <div className="operator">
          <label>
            <span>当前操作人（提交/建批/修订参数）</span>
            <input
              value={operatorDraft}
              onChange={(e) => setOperatorDraft(e.target.value)}
              onBlur={commitOperator}
              placeholder="owner-li"
            />
          </label>
          <button onClick={resetDemo}>重置演示数据</button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "tab active" : "tab"} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "console" && <Console data={data} operatorId={operatorId} />}
      {tab === "overview" && <Overview data={data} operatorId={operatorId} />}
      {tab === "profiles" && <PigeonProfiles data={data} operatorId={operatorId} />}

      <footer className="footer-note">
        核验规则：每羽在同一未结束批次仅可出现一次；早于放飞、缺航距、分速越界（400–1800 m/min）只留待复核；
        鸽主与传感器报时差异超过 60 秒保留双方原值，由提交人之外的另一人复核。所有排行、提醒、档案均由同一套规则函数即时推导。
      </footer>
    </main>
  );
}

export default App;
