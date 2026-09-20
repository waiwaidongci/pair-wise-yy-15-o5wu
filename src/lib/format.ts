// 展示层工具：时间/速度/距离的统一格式化，保证列表、统计、单羽档案口径一致。

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026-09-20T08:37" 或 ISO → "09-20 08:37" */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** 只显示时分，用于“报时双方原值”对照 */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "未报";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function fmtSpeed(m: number | null | undefined): string {
  if (m == null) return "—";
  return `${Math.round(m)} m/min`;
}

export function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "航距待补录";
  return m % 1000 === 0 ? `${m / 1000} km` : `${m} m`;
}

/** 输入框用的 datetime-local 值（本地时间，精确到分） */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** datetime-local（精确到秒）输入框值，报时对照需要秒级 */
export function toLocalInputSec(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function fmtMin(min: number | null | undefined): string {
  if (min == null) return "—";
  return `${Math.round(min * 10) / 10} 分钟`;
}
