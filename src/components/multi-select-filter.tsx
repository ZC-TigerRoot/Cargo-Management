"use client";

import { ChevronDown } from "lucide-react";

export type MultiSelectOption = {
  value: string;
  label: string;
  count?: number;
};

type Props = {
  label: string;
  value: string[];
  options: MultiSelectOption[];
  onChange: (value: string[]) => void;
};

export default function MultiSelectFilter({ label, value, options, onChange }: Props) {
  const selectedLabels = value.map(selected => options.find(option => option.value === selected)?.label ?? selected);
  const summary = value.length === 0
    ? `全部${label}`
    : value.length === 1
      ? selectedLabels[0]
      : `已选 ${value.length} 项`;

  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option]);
  }

  return <div className="multi-select-filter">
    <span className="multi-select-filter-label">{label}</span>
    <details className="multi-select-filter-details">
      <summary aria-label={`按${label}筛选`}>
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="multi-select-filter-menu">
        <label className="multi-select-filter-option">
          <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
          <span>全部{label}</span>
        </label>
        {options.map(option => <label className="multi-select-filter-option" key={option.value}>
          <input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option.value)} />
          <span>{option.label}</span>
          {option.count !== undefined && <small>{option.count}</small>}
        </label>)}
      </div>
    </details>
  </div>;
}
