"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Clock3, PenLine, ShieldCheck, Truck } from "lucide-react";

type Task = {
  taskNo: string;
  expiresAt: string;
  status: "pending" | "submitted";
  receiptNo?: string;
  submittedAt?: string;
  vehicles: { vin: string; model: string }[];
};

const showTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value));

const maskVin = (vin: string) => `············${vin.slice(-6)}`;

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取车辆照片"));
    reader.readAsDataURL(file);
  });
}

export default function DriverForm({ token }: { token: string }) {
  const [task, setTask] = useState<Task>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ receiptNo: string; submittedAt: string }>();
  const [photoName, setPhotoName] = useState("");
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/driver/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "无法加载提货任务");
        return result.data as Task;
      })
      .then(data => {
        setTask(data);
        if (data.status === "submitted" && data.receiptNo && data.submittedAt) setReceipt({ receiptNo: data.receiptNo, submittedAt: data.submittedAt });
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "无法加载提货任务");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const photo = form.get("photo");
      if (photo instanceof File && photo.size > 5_000_000) throw new Error("车辆照片不能超过 5 MB");
      const photoDataUrl = photo instanceof File && photo.size ? await fileDataUrl(photo) : undefined;
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch(`/api/v1/driver/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"), phone: form.get("phone"), plateNo: form.get("plateNo"), signature: form.get("signature"),
          pickupAt: new Date().toISOString(), confirmed: form.get("confirmed") === "on", photoDataUrl,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const firstError = Object.values(result.issues?.fieldErrors ?? {}).flat()[0];
        throw new Error(String(firstError || result.message || "签收提交失败"));
      }
      setReceipt({ receiptNo: result.data.receiptNo, submittedAt: result.data.submittedAt });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "签收提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="driver-page"><section className="driver-card"><p className="muted">正在验证提货任务…</p></section></main>;
  if (!task) return <main className="driver-page"><section className="driver-card"><h1>无法打开提货任务</h1><p className="form-error">{error}</p></section></main>;
  if (receipt) return <main className="driver-page"><section className="driver-card success-card"><CheckCircle2/><p className="eyebrow">提交成功</p><h1>提车签收已完成</h1><p>签收编号 {receipt.receiptNo}</p><div className="receipt"><span>提交时间</span><b>{showTime(receipt.submittedAt)}</b><span>车辆</span><b>{task.vehicles.map(vehicle => vehicle.model).join("、")}</b></div><p className="muted">本页面可安全关闭，仓库人员将继续完成核验。</p></section></main>;

  return <main className="driver-page"><section className="driver-card">
    <div className="driver-brand"><span>车</span><div><b>车仓通</b><small>安全提车签收</small></div></div>
    <div className="task-banner"><Truck/><div><p>提货任务</p><h1>{task.taskNo}</h1></div><span>待签收</span></div>
    {task.vehicles.map(vehicle => <div className="task-car" key={vehicle.vin}><div><small>本次提取车辆</small><h2>{vehicle.model}</h2><p>车架号 {maskVin(vehicle.vin)}</p></div><ShieldCheck/><p><Clock3/>二维码有效至 {showTime(task.expiresAt)}</p></div>)}
    <form onSubmit={submit}><h3>司机信息</h3><div className="form-grid">
      <label>司机姓名<input name="name" required minLength={2} placeholder="请输入姓名"/></label>
      <label>联系电话<input name="phone" required minLength={6} type="tel" placeholder="请输入手机号"/></label>
      <label className="span-2">车牌号码<input name="plateNo" required minLength={2} placeholder="请输入承运车辆车牌"/></label>
    </div><h3>现场凭证</h3><div className="upload-grid">
      <label><Camera/><b>{photoName || "拍摄车辆照片"}</b><small>图片最大 5 MB</small><input name="photo" type="file" accept="image/*" capture="environment" onChange={event => setPhotoName(event.target.files?.[0]?.name || "")}/></label>
      <label><PenLine/><b>签名确认</b><small>输入本人姓名作为电子签名</small><input name="signature" required aria-label="签名确认" placeholder="司机本人签名"/></label>
    </div><label className="check"><input name="confirmed" type="checkbox" required/>我已核对车辆信息，确认车辆已完成提取</label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button driver-submit" disabled={submitting}>{submitting ? "提交中…" : "确认提交签收"}</button><p className="safe-note"><ShieldCheck/>提交内容仅用于本次提货任务，链接到期后自动失效</p></form>
  </section></main>;
}
