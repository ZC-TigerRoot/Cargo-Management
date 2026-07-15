"use client";

import { FormEvent, useState } from "react";

export default function Login() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "登录失败");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login-page"><section className="login-card">
    <div className="brand-mark">车</div><p className="eyebrow">CARGO FLOW</p><h1>欢迎回到车仓通</h1>
    <p className="muted">使用已开通的公司账号进入汽车仓储协同平台</p>
    <form action="/login" method="post" onSubmit={submit}>
      <label>邮箱地址<input name="email" type="email" autoComplete="username" required /></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={submitting}>{submitting ? "登录中…" : "登录系统"}</button>
    </form>
  </section></main>;
}
