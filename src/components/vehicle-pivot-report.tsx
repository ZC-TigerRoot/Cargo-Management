"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Boxes, CarFront, CircleAlert, SlidersHorizontal } from "lucide-react";
import type { VehicleRecord } from "@/lib/domain";
import {
  createVehiclePivot,
  recordsForPivotScope,
  summarizeVehicleInventory,
  vehiclePivotDimensionLabels,
  vehiclePivotDimensions,
  vehiclePivotScopeLabels,
  type VehiclePivotDimension,
  type VehiclePivotScope,
} from "@/lib/vehicle-statistics";

export default function VehiclePivotReport({ records }: { records: VehicleRecord[] }) {
  const [scope, setScope] = useState<VehiclePivotScope>("inventory");
  const [rowDimension, setRowDimension] = useState<VehiclePivotDimension>("customer");
  const [columnDimension, setColumnDimension] = useState<VehiclePivotDimension>("releaseStage");
  const summary = useMemo(() => summarizeVehicleInventory(records), [records]);
  const scopedRecords = useMemo(() => recordsForPivotScope(records, scope), [records, scope]);
  const pivot = useMemo(
    () => createVehiclePivot(scopedRecords, rowDimension, columnDimension),
    [columnDimension, rowDimension, scopedRecords],
  );
  const unreleasedRate = summary.inventoryCount
    ? Math.round(summary.merchantUnreleasedCount / summary.inventoryCount * 100)
    : 0;
  const qualityItems = [
    { label: "未填写客户", count: summary.missingCustomerCount },
    { label: "未填写仓库", count: summary.missingWarehouseCount },
    { label: "缺商社放车但已有后续节点", count: summary.inconsistentReleaseSequenceCount },
    { label: "司机已签收但未填实际出库", count: summary.signedWithoutOutboundCount },
  ].filter(item => item.count > 0);

  function changeRowDimension(next: VehiclePivotDimension) {
    if (next === columnDimension) setColumnDimension(rowDimension);
    setRowDimension(next);
  }

  function changeColumnDimension(next: VehiclePivotDimension) {
    if (next === rowDimension) setRowDimension(columnDimension);
    setColumnDimension(next);
  }

  return <div className="vehicle-report">
    <section className="report-summary-grid" aria-label="库存关键指标">
      <article className="panel report-metric">
        <Boxes/>
        <div><span>当前在库</span><strong>{summary.inventoryCount}<small> 辆</small></strong><p>按入库、实际出库及司机签收事实计算</p></div>
      </article>
      <article className="panel report-metric report-metric-alert">
        <CircleAlert/>
        <div><span>商社未放</span><strong>{summary.merchantUnreleasedCount}<small> 辆</small></strong><p>占当前在库 {unreleasedRate}%</p></div>
      </article>
      <article className="panel report-metric">
        <CarFront/>
        <div><span>商社已放</span><strong>{summary.merchantReleasedCount}<small> 辆</small></strong><p>其中 {summary.pendingPickupCount} 辆已放待提货</p></div>
      </article>
      <article className="panel report-metric report-metric-age">
        <SlidersHorizontal/>
        <div><span>31 天以上</span><strong>{summary.overThirtyDaysCount}<small> 辆</small></strong><p>平均库存 {summary.averageInventoryDays.toFixed(1)} 天</p></div>
      </article>
    </section>

    <article className="panel pivot-panel">
      <header className="pivot-header">
        <div>
          <p className="eyebrow">自定义分析</p>
          <h3 id="inventory-pivot-title">库存数据透视</h3>
          <p>默认按客户查看各放车节点，可像 Excel 数据透视表一样切换行列维度。</p>
        </div>
        <span aria-live="polite">本表共 <b>{pivot.total}</b> 辆</span>
      </header>

      <div className="pivot-controls">
        <label>统计范围<select value={scope} onChange={event => setScope(event.target.value as VehiclePivotScope)}>
          {Object.entries(vehiclePivotScopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label>行字段<select value={rowDimension} onChange={event => changeRowDimension(event.target.value as VehiclePivotDimension)}>
          {vehiclePivotDimensions.map(value => <option value={value} key={value}>{vehiclePivotDimensionLabels[value]}</option>)}
        </select></label>
        <label>列字段<select value={columnDimension} onChange={event => changeColumnDimension(event.target.value as VehiclePivotDimension)}>
          {vehiclePivotDimensions.map(value => <option value={value} key={value}>{vehiclePivotDimensionLabels[value]}</option>)}
        </select></label>
        <button type="button" onClick={() => {
          setRowDimension(columnDimension);
          setColumnDimension(rowDimension);
        }}><ArrowUpDown/>交换行列</button>
      </div>

      {pivot.rows.length ? <div className="pivot-table-wrap">
        <table className="pivot-table" aria-labelledby="inventory-pivot-title">
          <caption className="pivot-table-caption">按{vehiclePivotDimensionLabels[rowDimension]}和{vehiclePivotDimensionLabels[columnDimension]}汇总的车辆数量</caption>
          <thead><tr>
            <th scope="col">{vehiclePivotDimensionLabels[rowDimension]} ↓<small>{vehiclePivotDimensionLabels[columnDimension]} →</small></th>
            {pivot.columns.map(column => <th scope="col" key={column}>{column}</th>)}
            <th scope="col" className="pivot-total">总计</th>
          </tr></thead>
          <tbody>{pivot.rows.map(row => <tr key={row.value}>
            <th scope="row">{row.value}</th>
            {row.cells.map((count, index) => <td className={count ? undefined : "pivot-zero"} key={pivot.columns[index]}>{count}</td>)}
            <td className="pivot-total"><b>{row.total}</b></td>
          </tr>)}</tbody>
          <tfoot><tr>
            <th scope="row">总计</th>
            {pivot.columnTotals.map((count, index) => <td key={pivot.columns[index]}><b>{count}</b></td>)}
            <td className="pivot-total"><b>{pivot.total}</b></td>
          </tr></tfoot>
        </table>
      </div> : <div className="pivot-empty">当前统计范围没有车辆，请调整筛选条件或统计范围。</div>}

      <footer className="pivot-notes">
        <p><b>口径说明</b> 当前在库 = 有入库日期、无实际出库日期且司机未签收；商社未放 = 当前在库且无有效商社通知放车日期。人工修改的状态不会覆盖这两个事实口径。</p>
        {summary.outboundNoticeCount > 0 && <p>当前在库中另有 <b>{summary.outboundNoticeCount}</b> 辆已交付出库通知、尚未填写实际出库日期。</p>}
        {(pivot.groupedRowValues > 0 || pivot.groupedColumnValues > 0) && <p>为保证大数据量下的操作流畅，低频分类已合并：行字段 {pivot.groupedRowValues} 项、列字段 {pivot.groupedColumnValues} 项。</p>}
        {qualityItems.length > 0 && <div className="pivot-quality"><span>数据待完善</span>{qualityItems.map(item => <i key={item.label}>{item.label} <b>{item.count}</b></i>)}</div>}
      </footer>
    </article>
  </div>;
}
