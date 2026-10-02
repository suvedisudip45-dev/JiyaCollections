/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Eye, Pencil, Plus, Search, ShieldCheck, UserRoundCog, UserRoundX, X } from "lucide-react";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";
import { backendUrl } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const PORTALS = [
  { key: "ADMIN", path: "admin", label: "Admin", read: "access:admin_users_read", update: "access:admin_users_update", deactivate: "access:admin_users_deactivate" },
  { key: "MARKETING_PARTNER", path: "marketing-partners", label: "Marketing partners", read: "access:marketing_users_read", update: "access:marketing_users_update", deactivate: "access:marketing_users_deactivate" },
  { key: "MANUFACTURER", path: "manufacturers", label: "Manufacturers", read: "access:manufacturer_users_read", update: "access:manufacturer_users_update", deactivate: "access:manufacturer_users_deactivate" },
  { key: "CUSTOMER", path: "customers", label: "Customers", read: "access:customer_users_read", update: "access:customer_users_update", deactivate: "access:customer_users_deactivate" },
];

const emptyForm = {
  displayName: "",
  firstName: "",
  lastName: "",
  contactNumber: "",
  email: "",
  password: "",
};

const errorMessage = (error, fallback) => error.response?.data?.message || fallback;

const Status = ({ value }) => {
  const active = value === "ACTIVE";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {value || "UNKNOWN"}
    </span>
  );
};

const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`max-h-[90vh] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </header>
      <div className="p-5">{children}</div>
    </section>
  </div>
);

const AccessUsers = ({ token }) => {
  const { account, can } = usePermissions();
  const readablePortals = useMemo(() => PORTALS.filter(({ read }) => can(read)), [can]);
  const [portalKey, setPortalKey] = useState(readablePortals[0]?.key || "ADMIN");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedRoleIds, setSelectedRoleIds] = useState([]);
  const [detail, setDetail] = useState(null);

  const portal = PORTALS.find(({ key }) => key === portalKey) || PORTALS[0];
  const isAdminPortal = portal.key === "ADMIN";
  const mayCreateAdmin = isAdminPortal && can("access:admin_users_create") && can("access:admin_users_assign_roles") && can("access:roles_read");
  const mayAssignRoles = isAdminPortal && can("access:admin_users_assign_roles") && can("access:roles_read");
  const actorAccountId = account?.id;
  const closeDialog = () => {
    setDialog(null);
    setForm(emptyForm);
    setSelectedRoleIds([]);
    setDetail(null);
  };

  useEffect(() => {
    if (!readablePortals.some(({ key }) => key === portalKey)) {
      setPortalKey(readablePortals[0]?.key || "ADMIN");
    }
  }, [readablePortals, portalKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current = true;
    const fetchUsers = async () => {
      if (!token || !can(portal.read)) return;
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(`${backendUrl}/api/admin/access/users/${portal.path}`, {
          params: { search, page, limit: 10 },
          headers: { token },
        });
        if (current && response.data.success) {
          setUsers(response.data.users || []);
          setPagination(response.data.pagination || null);
        }
      } catch (requestError) {
        if (current) setError(errorMessage(requestError, "Could not load users."));
      } finally {
        if (current) setLoading(false);
      }
    };
    fetchUsers();
    return () => { current = false; };
  }, [token, portal, page, search, refreshKey, can]);

  useEffect(() => {
    let current = true;
    if (!isAdminPortal || !token || !can("access:roles_read")) {
      setRoles([]);
      return () => { current = false; };
    }
    axios.get(`${backendUrl}/api/admin/access/roles`, {
      params: { limit: 100 },
      headers: { token },
    }).then((response) => {
      if (current && response.data.success) setRoles((response.data.roles || []).filter((role) => role.isActive));
    }).catch((requestError) => {
      if (current) toast.error(errorMessage(requestError, "Could not load Admin roles."));
    });
    return () => { current = false; };
  }, [isAdminPortal, token, refreshKey, can]);

  const openCreate = () => {
    setForm(emptyForm);
    setSelectedRoleIds([]);
    setDialog({ type: "create" });
  };

  const openEdit = (user) => {
    setForm({
      displayName: user.displayName || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      contactNumber: user.contactNumber || "",
      email: user.email || "",
      password: "",
    });
    setSelectedRoleIds(user.roles?.map((role) => role.id) || []);
    setDialog({ type: "edit", user });
  };

  const openRoles = (user) => {
    setSelectedRoleIds(user.roles?.map((role) => role.id) || []);
    setDialog({ type: "roles", user });
  };

  const openDetails = async (user) => {
    try {
      const response = await axios.get(`${backendUrl}/api/admin/access/users/${portal.path}/${user.id}`, { headers: { token } });
      setDetail(response.data.user);
      setDialog({ type: "detail", user });
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Could not load user details."));
    }
  };

  const saveUser = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (dialog.type === "create") {
        await axios.post(`${backendUrl}/api/admin/access/users/admin`, {
          ...form,
          roleIds: selectedRoleIds,
        }, { headers: { token } });
        toast.success("Admin account created. The user must change the initial password after signing in.");
      } else {
        const payload = {
          displayName: form.displayName,
          contactNumber: form.contactNumber,
          email: form.email,
        };
        if (isAdminPortal || portal.key === "CUSTOMER") {
          payload.firstName = form.firstName;
          payload.lastName = form.lastName;
        }
        await axios.patch(`${backendUrl}/api/admin/access/users/${portal.path}/${dialog.user.id}`, payload, { headers: { token } });
        toast.success("User details updated.");
      }
      closeDialog();
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      toast.error(errorMessage(requestError, "The user could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const saveRoles = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await axios.put(`${backendUrl}/api/admin/access/users/admin/${dialog.user.id}/roles`, { roleIds: selectedRoleIds }, { headers: { token } });
      toast.success("Admin roles updated.");
      closeDialog();
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Admin roles could not be updated."));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (user) => {
    const active = user.status !== "ACTIVE";
    const action = active ? "activate" : "deactivate";
    if (!window.confirm(`${action === "deactivate" ? "Deactivate" : "Activate"} ${user.displayName}? ${active ? "They will be able to sign in again." : "Their active sessions will be revoked."}`)) return;
    try {
      await axios.patch(`${backendUrl}/api/admin/access/users/${portal.path}/${user.id}/status`, { active }, { headers: { token } });
      toast.success(`Account ${active ? "activated" : "deactivated"}.`);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Account status could not be changed."));
    }
  };

  const toggleRole = (roleId) => {
    setSelectedRoleIds((current) => current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId]);
  };

  const isSelf = (user) => isAdminPortal && user.id === actorAccountId;

  if (!readablePortals.length) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to view portal accounts.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Access control</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Portal users</h1>
          <p className="mt-1 text-sm text-slate-500">Manage account details and sign-in access by portal.</p>
        </div>
        {mayCreateAdmin && isAdminPortal && (
          <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            <Plus size={16} /> Add Admin
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Portal user lists">
        {readablePortals.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={portalKey === item.key} onClick={() => { setPortalKey(item.key); setPage(1); }} className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${portalKey === item.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}>
            {item.label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">{portal.label}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{pagination?.total ?? 0} accounts</p>
          </div>
          <label className="relative block w-full sm:max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, or phone" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
          </label>
        </div>

        {error && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email / phone</th>
                {isAdminPortal && <th className="px-4 py-3 font-semibold">Roles</th>}
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Last sign-in</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={isAdminPortal ? 6 : 5} className="px-4 py-12 text-center text-slate-500">Loading users...</td></tr>}
              {!loading && !error && users.length === 0 && <tr><td colSpan={isAdminPortal ? 6 : 5} className="px-4 py-14 text-center text-slate-500">No {portal.label.toLowerCase()} found.</td></tr>}
              {!loading && users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-slate-900">{user.displayName}</div>
                    {user.mustChangePassword && <div className="mt-1 text-xs font-medium text-amber-700">Password change required</div>}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    <div>{user.email}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{user.contactNumber || "No phone"}</div>
                  </td>
                  {isAdminPortal && <td className="max-w-64 px-4 py-3.5 text-xs text-slate-600">{user.roles?.map((role) => role.name).join(", ") || "No active roles"}</td>}
                  <td className="px-4 py-3.5"><Status value={user.status} /></td>
                  <td className="px-4 py-3.5 text-xs text-slate-500">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button type="button" title="View details" aria-label={`View ${user.displayName}`} onClick={() => openDetails(user)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Eye size={16} /></button>
                      {can(portal.update) && !isSelf(user) && <button type="button" title="Edit account" aria-label={`Edit ${user.displayName}`} onClick={() => openEdit(user)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><Pencil size={16} /></button>}
                      {mayAssignRoles && !isSelf(user) && <button type="button" title="Assign Admin roles" aria-label={`Assign roles to ${user.displayName}`} onClick={() => openRoles(user)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ShieldCheck size={16} /></button>}
                      {can(portal.deactivate) && !isSelf(user) && ["ACTIVE", "INACTIVE"].includes(user.status) && <button type="button" title={user.status === "ACTIVE" ? "Deactivate account" : "Activate account"} aria-label={`${user.status === "ACTIVE" ? "Deactivate" : "Activate"} ${user.displayName}`} onClick={() => toggleStatus(user)} className={`rounded-md p-2 ${user.status === "ACTIVE" ? "text-slate-500 hover:bg-red-50 hover:text-red-700" : "text-emerald-700 hover:bg-emerald-50"}`}>
                        {user.status === "ACTIVE" ? <UserRoundX size={16} /> : <UserRoundCog size={16} />}
                      </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination && <div className="border-t border-slate-100 px-4"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} /></div>}
      </section>

      {dialog?.type === "detail" && detail && (
        <Modal title="Account details" onClose={closeDialog} wide>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div><div className="text-xs font-semibold uppercase text-slate-400">Display name</div><div className="mt-1 font-semibold text-slate-900">{detail.displayName}</div></div>
              <div><div className="text-xs font-semibold uppercase text-slate-400">Email</div><div className="mt-1 text-slate-700">{detail.email}</div></div>
              <div><div className="text-xs font-semibold uppercase text-slate-400">Contact</div><div className="mt-1 text-slate-700">{detail.contactNumber || "Not set"}</div></div>
              <div><div className="text-xs font-semibold uppercase text-slate-400">Status</div><div className="mt-1"><Status value={detail.status} /></div></div>
              {isAdminPortal && <div><div className="text-xs font-semibold uppercase text-slate-400">Assigned roles</div><div className="mt-1 text-slate-700">{detail.roles?.map((role) => role.name).join(", ") || "None"}</div></div>}
            </div>
            {isAdminPortal && (
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Effective permissions</h3>
                <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {detail.effectivePermissions?.length ? <ul className="space-y-1 font-mono text-xs text-slate-700">{detail.effectivePermissions.map((permission) => <li key={permission}>{permission}</li>)}</ul> : <p className="text-xs text-slate-500">No active permissions.</p>}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {(dialog?.type === "create" || dialog?.type === "edit") && (
        <Modal title={dialog.type === "create" ? "Create Admin account" : `Edit ${portal.label.toLowerCase()}`} onClose={closeDialog}>
          <form onSubmit={saveUser} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Display name<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label>
              {(isAdminPortal || portal.key === "CUSTOMER") && <>
                <label className="text-xs font-semibold text-slate-600">First name<input required value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label>
                <label className="text-xs font-semibold text-slate-600">Last name<input required value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label>
              </>}
              <label className="text-xs font-semibold text-slate-600">Email address<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label>
              <label className="text-xs font-semibold text-slate-600">Contact number<input value={form.contactNumber} onChange={(event) => setForm({ ...form, contactNumber: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label>
              {dialog.type === "create" && <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Initial password<input required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /><span className="mt-1 block font-normal text-slate-500">The new Admin must replace this password at first sign-in.</span></label>}
            </div>
            {dialog.type === "create" && <RoleChoices roles={roles} selected={selectedRoleIds} onToggle={toggleRole} />}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={closeDialog} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button disabled={saving || (dialog.type === "create" && selectedRoleIds.length === 0)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : dialog.type === "create" ? "Create account" : "Save changes"}</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog?.type === "roles" && (
        <Modal title={`Admin roles · ${dialog.user.displayName}`} onClose={closeDialog}>
          <form onSubmit={saveRoles} className="space-y-4">
            <RoleChoices roles={roles} selected={selectedRoleIds} onToggle={toggleRole} />
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={closeDialog} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button disabled={saving || selectedRoleIds.length === 0} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save roles"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

const RoleChoices = ({ roles, selected, onToggle }) => (
  <fieldset>
    <legend className="text-xs font-semibold uppercase text-slate-500">Admin roles</legend>
    <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {roles.length === 0 && <p className="p-2 text-sm text-slate-500">No active Admin roles are available.</p>}
      {roles.map((role) => (
        <label key={role.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 hover:bg-slate-50">
          <input type="checkbox" checked={selected.includes(role.id)} onChange={() => onToggle(role.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{role.name}</span><span className="block truncate font-mono text-[11px] text-slate-500">{role.code} · {role.permissionCount ?? ""} permissions</span></span>
          {role.isSystemRole && <span className="text-[10px] font-semibold uppercase text-amber-700">System</span>}
        </label>
      ))}
    </div>
  </fieldset>
);

export default AccessUsers;