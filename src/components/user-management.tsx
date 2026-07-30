"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Menu,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import SideNav from "@/components/side-nav";
import { ChangelogButton } from "@/components/changelog-modal";
import { formatCalendarDate } from "@/lib/datetime";
import { roleLabels, type Role } from "@/lib/domain";
import { useSession } from "@/lib/use-session";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  customerId: string | null;
  warehouseIds: string[];
  createdAt: string;
};

type UserOptions = {
  customers: { id: string; name: string }[];
  warehouses: { id: string; name: string; location: string }[];
};

type UserFormInput = {
  id?: string;
  name: string;
  email?: string;
  password?: string;
  role: Role;
  customerId: string | null;
  warehouseIds: string[];
};

const roleDescriptions: Record<Role, string> = {
  admin: "管理全部业务、账号与系统设置",
  forwarder: "管理业务数据与基础设置",
  warehouse: "仅访问分配的仓库数据",
  customer: "仅查看绑定客户的数据",
};

export default function UserManagement() {
  const [mobile, setMobile] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [options, setOptions] = useState<UserOptions>({ customers: [], warehouses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [dialogUser, setDialogUser] = useState<UserRow | "create" | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [pendingId, setPendingId] = useState("");
  const { user: currentUser } = useSession();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/users", { signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (response.status === 403) {
          window.location.assign("/");
          return;
        }
        if (!response.ok) throw new Error(result.message || "无法读取用户");
        setUsers(result.data);
        setOptions(result.meta);
      })
      .catch(reason => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "无法读取用户");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return users.filter(user => {
      const matchesQuery = !keyword || `${user.name} ${user.email} ${roleLabels[user.role]} ${scopeLabel(user, options)}`.toLowerCase().includes(keyword);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? user.active : !user.active);
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [options, query, roleFilter, statusFilter, users]);

  const activeCount = users.filter(user => user.active).length;
  const adminCount = users.filter(user => user.role === "admin" && user.active).length;
  const scopedCount = users.filter(user => user.role === "warehouse" || user.role === "customer").length;

  async function saveUser(input: UserFormInput) {
    setError("");
    setMessage("");
    const creating = !input.id;
    const response = await fetch("/api/v1/users", {
      method: creating ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || (creating ? "创建用户失败" : "保存用户失败"));
    setUsers(current => creating
      ? [...current, result.data]
      : current.map(item => item.id === result.data.id ? result.data : item));
    setMessage(creating ? `已创建 ${result.data.name} 的账号` : `已保存 ${result.data.name} 的账号设置`);
  }

  async function toggleActive(target: UserRow) {
    if (target.active && !window.confirm(`确定停用“${target.name}”吗？停用后该用户将无法登录。`)) return;
    setPendingId(target.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, active: !target.active }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "更新账号状态失败");
      setUsers(current => current.map(item => item.id === result.data.id ? result.data : item));
      setMessage(`已${result.data.active ? "启用" : "停用"} ${result.data.name} 的账号`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新账号状态失败");
    } finally {
      setPendingId("");
    }
  }

  async function resetPassword(target: UserRow, password: string) {
    setError("");
    setMessage("");
    const response = await fetch("/api/v1/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: target.id, password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "重置密码失败");
    if (target.id === currentUser?.id) {
      window.location.assign("/login");
      return;
    }
    setMessage(`已重置 ${result.data.name} 的密码，原有登录会话已失效`);
  }

  return <div className="app-shell">
    <SideNav
      open={mobile}
      onClose={() => setMobile(false)}
      role={currentUser?.role}
      roleLabel={currentUser ? roleLabels[currentUser.role] : "管理员"}
      userName={currentUser?.name}
    />
    <main className="main">
      <header className="topbar">
        <button className="menu" onClick={() => setMobile(true)} aria-label="打开菜单"><Menu /></button>
        <div><p>系统管理</p><h1>用户管理</h1></div>
        <div className="top-actions">
          <ChangelogButton />
          <button className="primary-button" onClick={() => setDialogUser("create")}><Plus />新建用户</button>
        </div>
      </header>

      <section className="content user-management">
        <div className="module-heading user-page-heading">
          <div><p className="eyebrow">ADMIN ONLY</p><h2>用户与权限</h2><p>创建系统账号，分配角色和可访问的业务数据范围。</p></div>
          <span className="admin-only-badge"><ShieldCheck />仅管理员可用</span>
        </div>

        <div className="user-summary-grid">
          <article className="panel user-summary-card"><Users /><div><span>全部用户</span><strong>{users.length}</strong></div></article>
          <article className="panel user-summary-card"><UserCheck /><div><span>启用账号</span><strong>{activeCount}</strong></div></article>
          <article className="panel user-summary-card"><ShieldCheck /><div><span>启用管理员</span><strong>{adminCount}</strong></div></article>
          <article className="panel user-summary-card"><UserX /><div><span>受限数据账号</span><strong>{scopedCount}</strong></div></article>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-success user-success" role="status">{message}</p>}

        <article className="panel user-list-panel">
          <div className="user-list-toolbar">
            <label className="search user-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索姓名、邮箱、角色或数据范围…" /></label>
            <select value={roleFilter} onChange={event => setRoleFilter(event.target.value as Role | "all")} aria-label="按角色筛选">
              <option value="all">全部角色</option>
              {Object.entries(roleLabels).map(([role, label]) => <option value={role} key={role}>{label}</option>)}
            </select>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as "all" | "active" | "inactive")} aria-label="按状态筛选">
              <option value="all">全部状态</option>
              <option value="active">已启用</option>
              <option value="inactive">已停用</option>
            </select>
            <span className="result-count">{filteredUsers.length} 位用户</span>
          </div>

          <div className="table-wrap user-table-wrap">
            <table className="user-table">
              <thead><tr><th>用户</th><th>角色</th><th>数据范围</th><th>状态</th><th>创建日期</th><th>操作</th></tr></thead>
              <tbody>{filteredUsers.map(target => {
                const isCurrent = target.id === currentUser?.id;
                return <tr key={target.id}>
                  <td><div className="user-identity"><span className="avatar">{target.name[0] || "用"}</span><div><b>{target.name}{isCurrent && <em>当前账号</em>}</b><small>{target.email}</small></div></div></td>
                  <td><span className={`user-role user-role-${target.role}`}>{roleLabels[target.role]}</span><small>{roleDescriptions[target.role]}</small></td>
                  <td><b className="scope-value">{scopeLabel(target, options)}</b></td>
                  <td><span className={target.active ? "account-status active" : "account-status inactive"}><i />{target.active ? "已启用" : "已停用"}</span></td>
                  <td>{formatCalendarDate(target.createdAt) || "—"}</td>
                  <td><div className="user-row-actions"><button type="button" onClick={() => setDialogUser(target)}><Pencil />编辑</button><button type="button" onClick={() => setResetUser(target)}><KeyRound />重置密码</button><button type="button" className={target.active ? "danger" : "activate"} disabled={pendingId === target.id || (isCurrent && target.active)} title={isCurrent && target.active ? "不能停用当前登录账号" : undefined} onClick={() => toggleActive(target)}>{pendingId === target.id ? "处理中…" : target.active ? "停用" : "启用"}</button></div></td>
                </tr>;
              })}</tbody>
            </table>
            {loading && <div className="empty">正在读取用户…</div>}
            {!loading && !filteredUsers.length && <div className="empty">没有符合筛选条件的用户</div>}
          </div>
        </article>
      </section>
    </main>

    {dialogUser && <UserDialog
      key={dialogUser === "create" ? "create" : dialogUser.id}
      user={dialogUser === "create" ? undefined : dialogUser}
      options={options}
      onClose={() => setDialogUser(null)}
      onSave={saveUser}
    />}
    {resetUser && <ResetPasswordDialog
      key={resetUser.id}
      user={resetUser}
      current={resetUser.id === currentUser?.id}
      onClose={() => setResetUser(null)}
      onReset={resetPassword}
    />}
  </div>;
}

function UserDialog({ user, options, onClose, onSave }: {
  user?: UserRow;
  options: UserOptions;
  onClose: () => void;
  onSave: (input: UserFormInput) => Promise<void>;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "forwarder");
  const [customerId, setCustomerId] = useState(user?.customerId ?? "");
  const [warehouseIds, setWarehouseIds] = useState<string[]>(user?.warehouseIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        id: user?.id,
        name,
        email,
        password: user ? undefined : password,
        role,
        customerId: role === "customer" ? customerId || null : null,
        warehouseIds: role === "warehouse" ? warehouseIds : [],
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存用户失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleWarehouse(id: string) {
    setWarehouseIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-title"><div><p className="eyebrow">账号设置</p><h2 id="user-dialog-title">{user ? "编辑用户" : "新建用户"}</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X /></button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>姓名<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label>
          <label>登录邮箱<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" required /></label>
          {!user && <><label>初始密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" placeholder="至少 12 位" required /></label><label>确认初始密码<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required /></label><small className="field-help span-2">请通过安全渠道告知用户，避免在聊天或邮件正文中发送密码。</small></>}
          <label className="span-2">角色<select value={role} onChange={event => setRole(event.target.value as Role)}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label} · {roleDescriptions[value as Role]}</option>)}</select></label>
        </div>

        {role === "customer" && <fieldset className="user-scope-fieldset"><legend>客户数据范围</legend><label>绑定客户<select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">未分配客户</option>{options.customers.map(customer => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><p>未分配客户时，该账号不会看到任何车辆数据。</p></fieldset>}

        {role === "warehouse" && <fieldset className="user-scope-fieldset"><legend>仓库数据范围</legend><div className="warehouse-option-list">{options.warehouses.map(warehouse => <label key={warehouse.id}><input type="checkbox" checked={warehouseIds.includes(warehouse.id)} onChange={() => toggleWarehouse(warehouse.id)} /><span><b>{warehouse.name}</b><small>{warehouse.location}</small></span></label>)}{!options.warehouses.length && <p>暂无可分配的仓库</p>}</div><p>未选择仓库时，该账号不会看到任何车辆数据。</p></fieldset>}

        {(role === "admin" || role === "forwarder") && <div className="full-access-note"><ShieldCheck /><div><b>全部业务数据</b><p>{roleDescriptions[role]}，无需额外绑定数据范围。</p></div></div>}

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? "保存中…" : user ? "保存设置" : "创建用户"}</button></div>
      </form>
    </section>
  </div>;
}

function ResetPasswordDialog({ user, current, onClose, onReset }: {
  user: UserRow;
  current: boolean;
  onClose: () => void;
  onReset: (user: UserRow, password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onReset(user, password);
      if (!current) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重置密码失败");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-title"><div><p className="eyebrow">账号安全</p><h2 id="password-dialog-title">重置密码</h2></div><button type="button" onClick={onClose} aria-label="关闭"><X /></button></div>
      <div className="password-user"><span className="avatar">{user.name[0] || "用"}</span><div><b>{user.name}</b><small>{user.email}</small></div></div>
      <div className="password-warning"><KeyRound /><p>保存后，该用户在其他设备上的现有登录会话将立即失效。{current ? "当前设备也会退出登录。" : ""}</p></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="span-2">新密码<input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" placeholder="至少 12 位" required /></label>
          <label className="span-2">确认新密码<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? "重置中…" : "确认重置"}</button></div>
      </form>
    </section>
  </div>;
}

function scopeLabel(user: UserRow, options: UserOptions) {
  if (user.role === "admin" || user.role === "forwarder") return "全部业务数据";
  if (user.role === "customer") return options.customers.find(customer => customer.id === user.customerId)?.name ?? "未绑定客户";
  const names = user.warehouseIds.map(id => options.warehouses.find(warehouse => warehouse.id === id)?.name).filter(Boolean);
  return names.length ? names.join("、") : "未分配仓库";
}
