import Link from "next/link";
export default function Login() { return <main className="login-page"><section className="login-card"><div className="brand-mark">车</div><p className="eyebrow">CARGO FLOW</p><h1>欢迎回到车仓通</h1><p className="muted">使用公司邮箱进入汽车仓储协同平台</p><form><label>邮箱地址<input type="email" defaultValue="operator@example.com" /></label><label>密码<input type="password" defaultValue="demo-password" /></label><Link className="primary-button" href="/">登录系统</Link></form><p className="login-foot">演示账号可直接登录 · 数据仅用于功能预览</p></section></main> }

