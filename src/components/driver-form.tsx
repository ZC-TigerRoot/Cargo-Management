"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Clock3, ShieldCheck, Truck } from "lucide-react";

type Task = {
  taskNo: string;
  expiresAt: string;
  status: "pending" | "submitted";
  receiptNo?: string;
  submittedAt?: string;
  vehicles: { vin: string; model: string }[];
};

const showTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
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
      if (!(photo instanceof File) || !photo.size) throw new Error("请上传车辆照片");
      if (!photo.type.startsWith("image/")) throw new Error("请上传有效的图片文件");
      if (photo.size > 5_000_000) throw new Error("车辆照片不能超过 5 MB");
      const photoDataUrl = await fileDataUrl(photo);
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch(`/api/v1/driver/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupAt: new Date().toISOString(), photoDataUrl,
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
  if (receipt) return <main className="driver-page"><section className="driver-card success-card"><CheckCircle2/><p className="eyebrow">上传成功</p><h1>提车凭证已提交</h1><p>签收编号 {receipt.receiptNo}</p><div className="receipt"><span>提交时间</span><b>{showTime(receipt.submittedAt)}</b><span>车辆</span><b>{task.vehicles.map(vehicle => vehicle.model).join("、")}</b></div><p className="muted">本页面可安全关闭，仓库人员将继续完成核验。</p></section></main>;

  return <main className="driver-page"><section className="driver-card">
    <div className="driver-brand"><span>车</span><div><b>车仓通</b><small>安全提车签收</small></div></div>
    <div className="task-banner"><Truck/><div><p>提货任务</p><h1>{task.taskNo}</h1></div><span>待签收</span></div>
    {task.vehicles.map(vehicle => <div className="task-car" key={vehicle.vin}><div><small>本次提取车辆</small><h2>{vehicle.model}</h2><p>车架号 {maskVin(vehicle.vin)}</p></div><ShieldCheck/><p><Clock3/>二维码有效至 {showTime(task.expiresAt)}</p></div>)}
    <form onSubmit={submit}><h3>现场凭证</h3><div className="upload-grid">
      <label className="driver-photo-upload"><Camera/><b>{photoName || "拍摄或上传车辆照片"}</b><small>必须上传图片，最大 5 MB</small><input name="photo" type="file" accept="image/*" capture="environment" required onChange={event => setPhotoName(event.target.files?.[0]?.name || "")}/></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button driver-submit" disabled={submitting}>{submitting ? "上传中…" : "上传图片并完成签收"}</button><p className="safe-note"><ShieldCheck/>上传图片仅用于本次提货任务，链接到期后自动失效</p></form>
  </section></main>;
}
