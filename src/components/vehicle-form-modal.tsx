"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { vehicleStatuses, type BusinessType, type VehicleFormValues, type VehicleRecord, type VehicleStatus } from "@/lib/domain";
import { CHINA_TIME_ZONE } from "@/lib/datetime";
import { MAX_VEHICLE_NOTES_LENGTH } from "@/lib/vehicle-notes";

type Props = {
  defaultType?: BusinessType;
  initial?: VehicleRecord;
  onClose: () => void;
  onSaved: (record: VehicleRecord) => void;
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
    const date = (name: string) => text(name);
    const number = (name: string) => {
      const value = text(name);
      return value === undefined ? undefined : Number(value);
    };
    const payload: VehicleFormValues = {
      type,
      vin: text("vin"),
      model: text("model"),
      brand: text("brand"),
      referenceNo: text("referenceNo"),
      hsCode: text("hsCode"),
      portOfLoad: text("portOfLoad"),
      portOfDischarge: text("portOfDischarge"),
      vesselVoyage: text("vesselVoyage"),
      etd: date("etd"),
      eta: date("eta"),
      manufacturer: text("manufacturer"),
      warehouseLocation: text("warehouseLocation"),
      warehouse: text("warehouse"),
      warehouseTimezone: CHINA_TIME_ZONE,
      customer: text("customer"),
      inboundAt: date("inboundAt"),
      inventoryDays: number("inventoryDays"),
      inboundAmount: text("inboundAmount"),
      inboundBoeNo: text("inboundBoeNo"),
      merchantReleaseAt: date("merchantReleaseAt"),
      transferDocNoticeAt: date("transferDocNoticeAt"),
      customerReleaseAt: date("customerReleaseAt"),
      pickupDetails: text("pickupDetails"),
      outboundAt: date("outboundAt"),
      outboundBoeNo: text("outboundBoeNo"),
      outboundBoeTitle: text("outboundBoeTitle"),
      outboundAmount: text("outboundAmount"),
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
          version: initial.version,
          ...payload,
          status: status !== initial.status ? status : undefined,
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

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal vehicle-modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-title">
        <div><p className="eyebrow">{initial ? "更新业务节点" : "新建车辆档案"}</p><h2>{initial ? "编辑车辆" : "录入车辆"}</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭"><X /></button>
      </div>
      <form action={submit}>
        {!initial && <p className="data-warning">所有业务字段均可暂不填写；保存后可在车辆详情中继续补充。</p>}
        {initial && <fieldset className={`form-section status-editor${status === "异常" ? " status-editor-alert" : ""}`}>
          <legend>当前车辆状态</legend>
          <div className="form-grid">
            <label>状态<select name="status" value={status} onChange={event => setStatus(event.target.value as VehicleStatus)}>{vehicleStatuses.map(item => <option value={item} key={item}>{item}</option>)}</select></label>
            <label>状态变更说明<input name="statusReason" required={status !== initial.status} disabled={status === initial.status} placeholder={status === initial.status ? "状态未变化" : "请填写本次变更原因"} /></label>
          </div>
          <p className="status-help">手动变更状态将追加一条不可覆盖的业务事件。不手动调整时，系统会按业务日期自动更新状态；人工设定过的状态（如“异常”）将保持不变。</p>
        </fieldset>}
        <fieldset className="form-section">
          <legend>车辆与批次</legend>
          <div className="form-grid">
            <label>业务类型<select name="type" value={type} onChange={event => setType(event.target.value as BusinessType)}><option value="overseas">海外保税仓</option><option value="domestic">国内仓储</option></select></label>
            <label>车架号<input name="vin" maxLength={100} defaultValue={value("vin")} /></label>
            <label>车型<input name="model" defaultValue={value("model")} /></label>
            {type === "domestic" && <label>品牌<input name="brand" defaultValue={value("brand")} /></label>}
            {type === "domestic" && <label>生产商<input name="manufacturer" defaultValue={value("manufacturer")} /></label>}
            <label>{type === "overseas" ? "提单号" : "PO#"}<input name="referenceNo" defaultValue={value("referenceNo")} /></label>
            {type === "overseas" && <label>HS#<input name="hsCode" defaultValue={value("hsCode")} /></label>}
            {type === "overseas" && <label>起运港<input name="portOfLoad" defaultValue={value("portOfLoad")} /></label>}
            {type === "overseas" && <label>目的港<input name="portOfDischarge" defaultValue={value("portOfDischarge")} /></label>}
            {type === "overseas" && <label>船名航次<input name="vesselVoyage" defaultValue={value("vesselVoyage")} /></label>}
            {type === "overseas" && <label>ETD<input type="date" name="etd" defaultValue={value("etd")} /></label>}
            {type === "overseas" && <label>ETA<input type="date" name="eta" defaultValue={value("eta")} /></label>}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>仓库与客户</legend>
          <div className="form-grid">
            <label>{type === "overseas" ? "保税仓地点" : "仓库地点"}<input name="warehouseLocation" defaultValue={value("warehouseLocation")} /></label>
            <label>入库仓库名称<input name="warehouse" defaultValue={value("warehouse")} /></label>
            <label>所属客人<input name="customer" defaultValue={value("customer")} /></label>
            <label>系统时区<input value="中国标准时间（Asia/Shanghai）" disabled readOnly /></label>
            <label>{type === "overseas" ? "入保税仓库日期" : "入仓库日期"}<input type="date" name="inboundAt" defaultValue={value("inboundAt")} /></label>
            <label>库存时间（天，可选）<input type="number" name="inventoryDays" min="0" step="1" defaultValue={value("inventoryDays")} /></label>
            <label>入库金额<input type="number" name="inboundAmount" min="0" step="0.01" defaultValue={value("inboundAmount")} /></label>
            <label>入库 BOE 号<input name="inboundBoeNo" defaultValue={value("inboundBoeNo")} /></label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>放车、出库与单据</legend>
          <div className="form-grid">
            <label>商社通知放车日期<input type="date" name="merchantReleaseAt" defaultValue={value("merchantReleaseAt")} /></label>
            {type === "overseas" && <label>客户通知做过户文件日期<input type="date" name="transferDocNoticeAt" defaultValue={value("transferDocNoticeAt")} /></label>}
            {type === "overseas" && <label>客户通知放车日期<input type="date" name="customerReleaseAt" defaultValue={value("customerReleaseAt")} /></label>}
            <label>实际出库日期<input type="date" name="outboundAt" defaultValue={value("outboundAt")} /></label>
            <label>出库 BOE 号<input name="outboundBoeNo" defaultValue={value("outboundBoeNo")} /></label>
            <label>BOE 抬头<input name="outboundBoeTitle" defaultValue={value("outboundBoeTitle")} /></label>
            <label>出库金额<input type="number" name="outboundAmount" min="0" step="0.01" defaultValue={value("outboundAmount")} /></label>
            <label className="span-2">出库提货明细<textarea name="pickupDetails" defaultValue={value("pickupDetails")} rows={3} /></label>
            <label>出库通知单交付给商社日期<input type="date" name="outboundNoticeDeliveredAt" defaultValue={value("outboundNoticeDeliveredAt")} /></label>
            <label>客户交付签收单日期<input type="date" name="customerReceiptDeliveredAt" defaultValue={value("customerReceiptDeliveredAt")} /></label>
            <label>外代交付签收单给商社日期<input type="date" name="agentReceiptDeliveredAt" defaultValue={value("agentReceiptDeliveredAt")} /></label>
            <label className="span-2">备注<textarea name="notes" defaultValue={value("notes")} rows={3} maxLength={MAX_VEHICLE_NOTES_LENGTH} /></label>
          </div>
        </fieldset>

        <p className="calculated-note">填写库存时间后直接使用该库存天数；未填写时按入库日期计算，未出库则计算到今天。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting}>{submitting ? "保存中…" : "保存记录"}</button></div>
      </form>
    </section>
  </div>;
}
