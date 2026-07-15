"use client";

import { useEffect, useState } from "react";
import type { VehicleRecord } from "./domain";

export function useVehicleRecords() {
  const [records, setRecords] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/vehicles", { signal: controller.signal })
      .then(async response => {
        if (response.status === 401) {
          window.location.assign("/login");
          throw new DOMException("Session expired", "AbortError");
        }
        if (!response.ok) throw new Error("database unavailable");
        return response.json() as Promise<{ data: VehicleRecord[] }>;
      })
      .then(result => {
        setRecords(result.data);
        setLoadError("");
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRecords([]);
        setLoadError("无法读取车辆数据，请稍后重试");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  function saveRecord(record: VehicleRecord) {
    setRecords(current => {
      const exists = current.some(item => item.id === record.id);
      return exists ? current.map(item => item.id === record.id ? record : item) : [record, ...current];
    });
    setLoadError("");
  }

  return { records, saveRecord, loading, loadError };
}
