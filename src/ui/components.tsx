import type { ReactNode } from "react";
import type { RepoResult } from "../storage/repository";
import { FLAG_TEXT, STATUS_TEXT } from "../domain/rules";
import type { EntryStatus, FlagCode } from "../domain/types";

export function Panel({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="heading">
        <div>
          {hint ? <p className="panel-hint">{hint}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function StatusBadge({ status }: { status: EntryStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_TEXT[status]}</span>;
}

export function FlagBadges({ flags }: { flags: FlagCode[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="flag-list">
      {flags.map((f) => (
        <span key={f} className={`badge flag-${f}`} title={FLAG_TEXT[f]}>
          {FLAG_TEXT[f]}
        </span>
      ))}
    </span>
  );
}

export function ResultBanner({
  result,
  fallbackMessage,
}: {
  result: RepoResult<unknown> | null;
  fallbackMessage?: string;
}) {
  if (!result) return null;
  if (result.ok) return null;
  const isConflict = result.status === 409;
  return (
    <div className={`banner ${isConflict ? "banner-conflict" : "banner-error"}`}>
      <b>{result.status}</b>
      <span>{result.message || fallbackMessage || "提交被拒绝"}</span>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}
