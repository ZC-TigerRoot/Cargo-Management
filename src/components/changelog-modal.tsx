"use client";

import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { APP_VERSION, changelog } from "@/lib/changelog";

export function ChangelogButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary-button changelog-button" onClick={() => setOpen(true)} aria-label="查看更新日志" title="更新日志">
      <History />更新日志
    </button>
    {open && <ChangelogModal onClose={() => setOpen(false)} />}
  </>;
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal changelog-dialog" role="dialog" aria-modal="true" aria-labelledby="changelog-title" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-title">
        <div>
          <p className="eyebrow">产品版本</p>
          <h2 id="changelog-title">更新日志</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭"><X /></button>
      </div>
      <div className="changelog-current">
        <span>当前版本</span>
        <strong>v{APP_VERSION}</strong>
      </div>
      <ol className="changelog-list">
        {changelog.map(entry => (
          <li key={entry.version} className="changelog-entry">
            <div className="changelog-entry-head">
              <b>v{entry.version}</b>
              <time dateTime={entry.date}>{entry.date}</time>
            </div>
            <p className="changelog-entry-title">{entry.title}</p>
            <ul>
              {entry.changes.map(change => <li key={change}>{change}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  </div>;
}
