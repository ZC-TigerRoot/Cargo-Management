"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Clock3, Phone, ShieldCheck, Truck, UserRound } from "lucide-react";

type Task = {
  taskNo: string;
  expiresAt: string;
  status: "pending" | "submitted";
  receiptNo?: string;
  submittedAt?: string;
  driverLabel?: string;
  driverName?: string;
  driverPhone?: string;
  vehicles: { id: string; vin?: string; model?: string }[];
};

type Receipt = Pick<Task, "receiptNo" | "submittedAt" | "driverLabel" | "driverName" | "driverPhone"> & {
  receiptNo: string;
  submittedAt: string;
};

type DriverApiResponse = {
  data?: Receipt;
  message?: string;
  issues?: { fieldErrors?: Record<string, string[]> };
};

const MAX_DRIVER_PHOTO_BYTES = 5_000_000;
const MOBILE_UPLOAD_TARGET_BYTES = 850_000;

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("无法处理所选图片")),
    "image/jpeg",
    quality,
  ));
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = document.createElement("img");
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取所选图片，请换一张照片重试"));
    };
    image.src = url;
  });
}

async function optimizePhoto(file: File) {
  if (file.size <= MOBILE_UPLOAD_TARGET_BYTES) return file;
  const image = await loadImage(file);
  const initialScale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
  let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
  let height = Math.max(1, Math.round(image.naturalHeight * initialScale));
  let smallest: Blob | undefined;

  for (let resize = 0; resize < 6; resize += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片，请换用系统浏览器重试");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      const blob = await canvasBlob(canvas, quality);
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= MOBILE_UPLOAD_TARGET_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, "") || "driver-photo";
        return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
      }
    }
    width = Math.max(1, Math.round(width * 0.78));
    height = Math.max(1, Math.round(height * 0.78));
  }

  if (!smallest) throw new Error("无法处理所选图片，请换一张照片重试");
  const name = file.name.replace(/\.[^.]+$/, "") || "driver-photo";
  return new File([smallest], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

async function readApiResponse(response: Response): Promise<DriverApiResponse> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) return response.json() as Promise<DriverApiResponse>;
  await response.text();
  if (response.status === 413) throw new Error("图片仍然过大，服务器未能接收，请重新拍摄或选择较小的图片");
  if (response.status >= 500) throw new Error("上传服务暂时不可用，请稍后重试");
  throw new Error(`服务器响应异常（${response.status}），请稍后重试`);
}

const showTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value));

const maskVin = (vin?: string) => vin ? `············${vin.slice(-6)}` : "未填写";

export default function DriverForm({ token }: { token: string }) {
  const [task, setTask] = useState<Task>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt>();
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
        if (data.status === "submitted" && data.receiptNo && data.submittedAt) setReceipt({ receiptNo: data.receiptNo, submittedAt: data.submittedAt, driverLabel: data.driverLabel, driverName: data.driverName, driverPhone: data.driverPhone });
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
      if (photo.size > MAX_DRIVER_PHOTO_BYTES) throw new Error("车辆照片不能超过 5 MB");
      idempotencyKey.current ??= crypto.randomUUID();
      const optimizedPhoto = await optimizePhoto(photo);
      form.set("photo", optimizedPhoto, optimizedPhoto.name);
      form.set("pickupAt", new Date().toISOString());
      form.set("idempotencyKey", idempotencyKey.current);
      const response = await fetch(`/api/v1/driver/${encodeURIComponent(token)}`, {
        method: "POST",
        body: form,
      });
      const result = await readApiResponse(response);
      if (!response.ok) {
        const firstError = Object.values(result.issues?.fieldErrors ?? {}).flat()[0];
        throw new Error(String(firstError || result.message || "签收提交失败"));
      }
      if (!result.data) throw new Error("服务器未返回签收结果，请刷新页面确认");
      setReceipt(result.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "签收提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="driver-page"><section className="driver-card"><p className="muted">正在验证提货任务…</p></section></main>;
  if (!task) return <main className="driver-page"><section className="driver-card"><h1>无法打开提货任务</h1><p className="form-error">{error}</p></section></main>;
  if (receipt) return <main className="driver-page"><section className="driver-card success-card"><CheckCircle2/><p className="eyebrow">上传成功</p><h1>提车凭证已提交</h1><p>签收编号 {receipt.receiptNo}</p><div className="receipt"><span>提交时间</span><b>{showTime(receipt.submittedAt)}</b><span>车辆</span><b>{task.vehicles.map(vehicle => vehicle.model || "未填写车型").join("、")}</b>{receipt.driverLabel && <><span>司机名称</span><b>{receipt.driverLabel}</b></>}{receipt.driverName && <><span>姓名</span><b>{receipt.driverName}</b></>}{receipt.driverPhone && <><span>联系电话</span><b>{receipt.driverPhone}</b></>}</div><p className="muted">本页面可安全关闭，仓库人员将继续完成核验。</p></section></main>;

  return <main className="driver-page"><section className="driver-card">
    <div className="driver-brand"><span>车</span><div><b>车仓通</b><small>安全提车签收</small></div></div>
    <div className="task-banner"><Truck/><div><p>提货任务</p><h1>{task.taskNo}</h1></div><span>待签收</span></div>
    {task.vehicles.map(vehicle => <div className="task-car" key={vehicle.id}><div><small>本次提取车辆</small><h2>{vehicle.model || "未填写车型"}</h2><p>车架号 {maskVin(vehicle.vin)}</p></div><ShieldCheck/><p><Clock3/>二维码有效至 {showTime(task.expiresAt)}</p></div>)}
    <form onSubmit={submit}><h3>司机信息</h3><div className="driver-info-fields"><label><span><UserRound/>姓名</span><input name="driverName" maxLength={100} autoComplete="name" required placeholder="请输入姓名" /></label><label><span><Phone/>联系电话</span><input name="driverPhone" type="tel" inputMode="tel" maxLength={30} autoComplete="tel" required placeholder="请输入联系电话" /></label></div><h3>现场凭证</h3><div className="upload-grid">
      <label className="driver-photo-upload"><Camera/><b>{photoName || "拍摄或上传车辆照片"}</b><small>原图最大 5 MB，手机照片将自动优化</small><input name="photo" type="file" accept="image/*" capture="environment" required onChange={event => setPhotoName(event.target.files?.[0]?.name || "")}/></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button driver-submit" disabled={submitting}>{submitting ? "上传中…" : "上传图片并完成签收"}</button><p className="safe-note"><ShieldCheck/>上传图片仅用于本次提货任务，链接到期后自动失效</p></form>
  </section></main>;
}
