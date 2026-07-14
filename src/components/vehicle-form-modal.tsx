"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { vehicleStatuses, type BusinessType, type VehicleFormValues, type VehicleRecord, type VehicleStatus } from "@/lib/domain";

type Props = {
  defaultType?: BusinessType;
  initial?: VehicleRecord;
  onClose: () => void;
  onSaved: (record: VehicleRecord) => void;
};

const localDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function VehicleFormModal({ defaultType = "overseas", initial, onClose, onSaved }: Props) {
  const [type, setType] = useState<BusinessType>(initial?.type ?? defaultType);
  const [status, setStatus] = useState<VehicleStatus>(initial?.status ?? "待入库");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setSubmitting(true);
    setError("");
    const text = (name: string) => String(formData.get(name) || "").trim() || undefined;
    const date = (name: string) => {
      const value = text(name);
      return value ? new Date(value).toISOString() : undefined;
    };
    const payload: VehicleFormValues = {
      type,
      vin: text("vin") || "",
      model: text("model") || "",
      brand: text("brand"),
      referenceNo: text("referenceNo") || "",
      hsCode: text("hsCode"),
      portOfLoad: text("portOfLoad"),
      portOfDischarge: text("portOfDischarge"),
      vesselVoyage: text("vesselVoyage"),
      etd: date("etd"),
      eta: date("eta"),
      manufacturer: text("manufacturer"),
      warehouseLocation: text("warehouseLocation") || "",
      warehouse: text("warehouse") || "",
      customer: text("customer") || "",
      inboundAt: date("inboundAt"),
      merchantReleaseAt: date("merchantReleaseAt"),
      transferDocNoticeAt: date("transferDocNoticeAt"),
      customerReleaseAt: date("customerReleaseAt"),
      pickupDetails: text("pickupDetails"),
      outboundAt: date("outboundAt"),
      outboundNoticeDeliveredAt: date("outboundNoticeDeliveredAt"),
      customerReceiptDeliveredAt: date("customerReceiptDeliveredAt"),
      agentReceiptDeliveredAt: date("agentReceiptDeliveredAt"),
      notes: text("notes"),
    };

    try {
      const response = await fetch("/api/v1/vehicles", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initial ? {
          id: initial.id,
          ...payload,
          status,
          statusReason: status !== initial.status ? text("statusReason") : undefined,
        } : { ...payload, idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) {
        const fieldErrors = result.issues?.fieldErrors as Record<string, string[]> | undefined;
        const firstError = fieldErrors && Object.values(fieldErrors).flat()[0];
        throw new Error(firstError || result.message || "保存失败，请检查填写内容");
      }
      onSaved(result.data as VehicleRecord);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const value = (field: keyof VehicleRecord) => String(initial?.[field] ?? "");
  const dateValue = (field: keyof VehicleRecord) => localDateTime(initial?.[field] as string | undefined);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal vehicle-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-title">
        <div><p className="eyebrow">{initial ? "更新业务节点" : "新建车辆档案"}</p><h2>{initial ? "编辑车辆" : "录入车辆"}</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭"><X /></button>
      </div>
      <form action={submit}>
        {initial && <fieldset className={`form-section status-editor${status === "异常" ? " status-editor-alert" : ""}`}>
          <legend>当前车辆状态</legend>
          <div className="form-grid">
            <label>状态<select name="status" value={status} onChange={event => setStatus(event.target.value as VehicleStatus)}>{vehicleStatuses.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
            <label>状态变更说明<input name="statusReason" required={status !== initial.status} disabled={status === initial.status} placeholder={status === initial.status ? "状态未变化" : "请填写本次变更原因"} /></label>
          </div>
          <p className="status-help">状态变更将立即反映在车辆台账，并追加一条不可覆盖的业务事件。</p>
        </fieldset>}
        <fieldset className="form-section">
          <legend>车辆与批次</legend>
          <div className="form-grid">
            <label>业务类型<select name="type" value={type} onChange={event => setType(event.target.value as BusinessType)}><option value="overseas">海外保税仓</option><option value="domestic">国内仓储</option></select></label>
            <label>车架号<input name="vin" minLength={17} maxLength={17} required defaultValue={value("vin")} placeholder="17 位 VIN" /></label>
            <label>车型<input name="model" required defaultValue={value("model")} /></label>
            {type === "domestic" && <label>品牌<input name="brand" defaultValue={value("brand")} /></label>}
            {type === "domestic" && <label>生产商<input name="manufacturer" defaultValue={value("manufacturer")} /></label>}
            <label>{type === "overseas" ? "提单号" : "PO#"}<input name="referenceNo" required defaultValue={value("referenceNo")} /></label>
            {type === "overseas" && <label>HS#<input name="hsCode" defaultValue={value("hsCode")} /></label>}
            {type === "overseas" && <label>起运港<input name="portOfLoad" defaultValue={value("portOfLoad")} /></label>}
            {type === "overseas" && <label>目的港<input name="portOfDischarge" defaultValue={value("portOfDischarge")} /></label>}
            {type === "overseas" && <label>船名航次<input name="vesselVoyage" defaultValue={value("vesselVoyage")} /></label>}
            {type === "overseas" && <label>ETD<input type="datetime-local" name="etd" defaultValue={dateValue("etd")} /></label>}
            {type === "overseas" && <label>ETA<input type="datetime-local" name="eta" defaultValue={dateValue("eta")} /></label>}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>仓库与客户</legend>
          <div className="form-grid">
            <label>{type === "overseas" ? "保税仓地点" : "仓库地点"}<input name="warehouseLocation" required defaultValue={value("warehouseLocation")} /></label>
            <label>入库仓库名称<input name="warehouse" required defaultValue={value("warehouse")} /></label>
            <label>所属客人<input name="customer" required defaultValue={value("customer")} /></label>
            <label>{type === "overseas" ? "入保税仓库时间" : "入仓库时间"}<input type="datetime-local" name="inboundAt" defaultValue={dateValue("inboundAt")} /></label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>放车、出库与单据</legend>
          <div className="form-grid">
            <label>商社通知放车时间<input type="datetime-local" name="merchantReleaseAt" defaultValue={dateValue("merchantReleaseAt")} /></label>
            {type === "overseas" && <label>客户通知做过户文件时间<input type="datetime-local" name="transferDocNoticeAt" defaultValue={dateValue("transferDocNoticeAt")} /></label>}
            {type === "overseas" && <label>客户通知放车时间<input type="datetime-local" name="customerReleaseAt" defaultValue={dateValue("customerReleaseAt")} /></label>}
            <label>实际出库时间<input type="datetime-local" name="outboundAt" defaultValue={dateValue("outboundAt")} /></label>
            <label className="span-2">出库提货明细<textarea name="pickupDetails" defaultValue={value("pickupDetails")} rows={3} /></label>
            <label>出库通知单交付给商社日期<input type="datetime-local" name="outboundNoticeDeliveredAt" defaultValue={dateValue("outboundNoticeDeliveredAt")} /></label>
            <label>客户交付签收单日期<input type="datetime-local" name="customerReceiptDeliveredAt" defaultValue={dateValue("customerReceiptDeliveredAt")} /></label>
            <label>外代交付签收单给商社时间<input type="datetime-local" name="agentReceiptDeliveredAt" defaultValue={dateValue("agentReceiptDeliveredAt")} /></label>
            <label className="span-2">备注<textarea name="notes" defaultValue={value("notes")} rows={3} /></label>
          </div>
        </fieldset>

        <p className="calculated-note">库存天数由入库时间和实际出库时间自动计算，无需填写。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "保存中…" : "保存记录"}</button></div>
      </form>
    </section>
  </div>;
}
