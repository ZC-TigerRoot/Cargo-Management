"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, FileSpreadsheet, RefreshCw, RotateCcw, Upload, X } from "lucide-react";
import type { VehicleRecord } from "@/lib/domain";
import { chinaToday, isCalendarDate } from "@/lib/datetime";
import { matchReentryVins, MAX_REENTRY_FILE_SIZE, MAX_REENTRY_VEHICLES, parseReentryVins, readReentryWorkbook, reentryDateIssue, reentryStatusIssue, type ReentryPreviewRow } from "@/lib/vehicle-reentry-preview";

type Props = {
  records: VehicleRecord[];
  selectedIds: string[];
  onClose: () => void;
  onSaved: (records: VehicleRecord[]) => void;
};

export default function VehicleReentryModal({ records, selectedIds, onClose, onSaved }: Props) {
  const [source, setSource] = useState<"selected" | "vins">(selectedIds.length ? "selected" : "vins");
  const [selection, setSelection] = useState(selectedIds);
  const [snapshot, setSnapshot] = useState(records);
  const [vinText, setVinText] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [inboundAt, setInboundAt] = useState(chinaToday);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const vins = useMemo(() => parseReentryVins(vinText), [vinText]);
  const preview = useMemo<ReentryPreviewRow[]>(() => {
    const matched = source === "vins" ? matchReentryVins(vins, snapshot) : selection.map(id => {
      const vehicle = snapshot.find(record => record.id === id);
      return { vin: vehicle?.vin || "未填写车架号", vehicle, issue: vehicle ? reentryStatusIssue(vehicle) : "车辆已不存在或当前账号无权查看" };
    });
    return matched.map(row => ({ ...row, issue: row.issue || (row.vehicle && isCalendarDate(inboundAt) ? reentryDateIssue(row.vehicle, inboundAt) : undefined) }));
  }, [inboundAt, selection, snapshot, source, vins]);
  const issueCount = preview.filter(row => row.issue).length;
  const canSubmit = preview.length > 0 && preview.length <= MAX_REENTRY_VEHICLES && !issueCount && isCalendarDate(inboundAt) && inboundAt <= chinaToday() && Boolean(reason.trim()) && !busy && !conflict;

  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  function close() {
    if (!busyRef.current) onClose();
  }

  async function readFile(file?: File) {
    if (!file) return;
    setError(""); setSource("vins"); setVinText(""); setFileLabel("");
    if (!/\.xlsx?$/i.test(file.name)) { setError("仅支持 .xlsx 或 .xls 文件"); return; }
    if (file.size > MAX_REENTRY_FILE_SIZE) { setError("Excel 文件不能超过 10 MB"); return; }
    setBusy(true); busyRef.current = true;
    try {
      const result = await readReentryWorkbook(await file.arrayBuffer());
      setVinText(result.vins.join("\n"));
      setFileLabel(`${file.name} · ${result.sheetNames.join("、")}`);
      setSource("vins");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取文件失败");
    } finally { setBusy(false); busyRef.current = false; }
  }

  async function refresh() {
    setBusy(true); busyRef.current = true; setError("");
    try {
      const response = await fetch("/api/v1/vehicles", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.data)) throw new Error(result.message || "重新读取车辆失败");
      setSnapshot(result.data as VehicleRecord[]);
      setConflict(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "重新读取车辆失败"); }
    finally { setBusy(false); busyRef.current = false; }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || busyRef.current) return;
    setBusy(true); busyRef.current = true; setError("");
    try {
      const response = await fetch("/api/v1/vehicles/reentry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles: preview.map(row => ({ id: row.vehicle!.id, version: row.vehicle!.version })), inboundAt, reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        const fieldErrors = result.issues?.fieldErrors as Record<string, string[]> | undefined;
        throw new Error(fieldErrors && Object.values(fieldErrors).flat()[0] || result.message || "再次入库失败，请稍后重试");
      }
      onSaved(result.data as VehicleRecord[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "再次入库失败，请稍后重试"); }
    finally { setBusy(false); busyRef.current = false; }
  }

  return <div className="modal-backdrop" onMouseDown={close}>
    <section ref={dialogRef} tabIndex={-1} className="modal vehicle-modal reentry-modal" role="dialog" aria-modal="true" aria-labelledby="reentry-title" onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)');
      const first = controls?.[0]; const last = controls?.[controls.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="modal-title"><div><p className="eyebrow">新一轮仓储</p><h2 id="reentry-title">批量再次入库</h2></div><button ref={closeRef} type="button" onClick={close} disabled={busy} aria-label="关闭"><X /></button></div>
      <form onSubmit={submit}>
        <fieldset className="reentry-source" disabled={busy}><legend>返库车辆</legend>
          <div className="reentry-source-tabs" role="tablist" aria-label="车辆来源">
            <button type="button" role="tab" aria-selected={source === "selected"} onClick={() => setSource("selected")}>已选车辆（{selection.length}）</button>
            <button type="button" role="tab" aria-selected={source === "vins"} onClick={() => setSource("vins")}>车架号名单</button>
          </div>
          {source === "vins" && <div className="reentry-vin-source"><label className="reentry-vin-label">车架号<textarea value={vinText} onChange={event => { setVinText(event.target.value); setFileLabel(""); }} rows={4} placeholder="每行一个车架号" aria-label="返库车架号名单" /></label><label className="secondary-button reentry-file"><Upload />选择 Excel<input type="file" accept=".xlsx,.xls" onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>{fileLabel && <p className="reentry-file-name"><FileSpreadsheet />{fileLabel}</p>}</div>}
        </fieldset>
        <div className="form-grid reentry-fields"><label>本次入库日期<input type="date" value={inboundAt} max={chinaToday()} onChange={event => setInboundAt(event.target.value)} required disabled={busy}/></label><label>返库原因<input value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required disabled={busy}/></label></div>
        <div className="reentry-preview-head"><h3>返库预览 <span>{preview.length} 台</span></h3><span className={issueCount ? "reentry-issues" : "muted"}>{issueCount ? `${issueCount} 条需处理` : preview.length ? "全部可再次入库" : "尚未选择车辆"}</span></div>
        {preview.length > MAX_REENTRY_VEHICLES && <p className="form-error" role="alert">单次最多再次入库 {MAX_REENTRY_VEHICLES} 台车辆</p>}
        <div className="table-wrap reentry-preview"><table><thead><tr><th>车架号 / 车型</th><th>当前仓库</th><th>当前状态</th><th>新轮次</th><th>核对结果</th>{source === "selected" && <th></th>}</tr></thead><tbody>{preview.map((row, index) => <tr key={`${row.vehicle?.id || row.vin}-${index}`}><td><b>{row.vin}</b><small>{row.vehicle?.model || "—"}</small></td><td>{row.vehicle?.warehouse || "—"}<small>{row.vehicle?.warehouseLocation}</small></td><td>{row.vehicle?.status || "—"}</td><td>{row.vehicle ? `第 ${(row.vehicle.currentCycle ?? 1) + 1} 轮` : "—"}</td><td className={row.issue ? "reentry-issues" : "reentry-valid"}>{row.issue || "可再次入库"}</td>{source === "selected" && <td><button type="button" className="reentry-remove" disabled={busy} onClick={() => setSelection(current => current.filter(id => id !== selection[index]))} title="移除此车" aria-label={`移除${row.vin}`}><X /></button></td>}</tr>)}</tbody></table>{!preview.length && <div className="empty">暂无返库车辆</div>}</div>
        <div className="reentry-summary"><RotateCcw /><p>确认后本轮状态为“在库”，放车、出库、签收及相关日期清空，库存天数从本次入库重新计算。上一轮出库、签收及附件保留在历史中。</p></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {conflict && <button type="button" className="secondary-button" onClick={refresh} disabled={busy}><RefreshCw />重新核对车辆</button>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={busy}>取消</button><button type="submit" className="primary-button" disabled={!canSubmit}><Check />{busy ? "处理中…" : `确认再次入库（${preview.length}）`}</button></div>
      </form>
    </section>
  </div>;
}
