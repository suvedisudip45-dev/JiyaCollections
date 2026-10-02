/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { LockKeyhole, Pencil, Plus, Search, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";
import { backendUrl } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const errorMessage = (error, fallback) => error.response?.data?.message || fallback;

const AccessRoles = ({ token }) => {
  const { account, can } = usePermissions();
  const [roles, setRoles] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissionQuery, setPermissionQuery] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionPage, setPermissionPage] = useState(1);
  const [permissionList, setPermissionList] = useState([]);
  const [permissionPagination, setPermissionPagination] = useState(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState([]);
  const [permissionLoading, setPermissionLoading] = useState(false);

  const mayRead = can("access:roles_read");
  const actorRoleIds = useMemo(() => new Set((account?.roles || []).map((role) => role.id)), [account]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(query.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current = true;
    const fetchRoles = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(`${backendUrl}/api/admin/access/roles`, {
          params: { search, page, limit: 10 },
          headers: { token },
        });
        if (current && response.data.success) {
          setRoles(response.data.roles || []);
          setPagination(response.data.pagination || null);
        }
      } catch (requestError) {
        if (current) setError(errorMessage(requestError, "Could not load Admin roles."));
      } finally {
        if (current) setLoading(false);
      }
    };
    if (token && mayRead) fetchRoles();
    return () => { current = false; };
  }, [token, mayRead, search, page, refreshKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPermissionPage(1);
      setPermissionSearch(permissionQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [permissionQuery]);

  useEffect(() => {
    let current = true;
    if (dialog?.type !== "permissions" || !can("access:permissions_read")) return () => { current = false; };
    setPermissionLoading(true);
    axios.get(`${backendUrl}/api/admin/access/permissions`, {
      params: { search: permissionSearch, page: permissionPage, limit: 50 },
      headers: { token },
    }).then((response) => {
      if (current && response.data.success) {
        setPermissionList(response.data.permissions || []);
        setPermissionPagination(response.data.pagination || null);
      }
    }).catch((requestError) => {
      if (current) toast.error(errorMessage(requestError, "Could not load permissions."));
    }).finally(() => {
      if (current) setPermissionLoading(false);
    });
    return () => { current = false; };
  }, [dialog, can, permissionSearch, permissionPage, token]);

  const openCreate = () => {
    setName("");
    setDescription("");
    setDialog({ type: "create" });
  };

  const openEdit = (role) => {
    setName(role.name);
    setDescription(role.description || "");
    setDialog({ type: "edit", role });
  };

  const openPermissions = async (role) => {
    try {
      const response = await axios.get(`${backendUrl}/api/admin/access/roles/${role.id}`, { headers: { token } });
      setSelectedPermissionIds(response.data.role.permissions.map((permission) => permission.id));
      setPermissionQuery("");
      setPermissionSearch("");
      setPermissionPage(1);
      setDialog({ type: "permissions", role: response.data.role });
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Could not load role permissions."));
    }
  };

  const submitRole = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (dialog.type === "create") {
        await axios.post(`${backendUrl}/api/admin/access/roles`, { name, description }, { headers: { token } });
        toast.success("Admin role created. Add its permissions before assigning it to users.");
      } else {
        await axios.patch(`${backendUrl}/api/admin/access/roles/${dialog.role.id}`, { name, description }, { headers: { token } });
        toast.success("Admin role updated.");
      }
      setDialog(null);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Role could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const savePermissions = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await axios.put(`${backendUrl}/api/admin/access/roles/${dialog.role.id}/permissions`, {
        permissionIds: selectedPermissionIds,
      }, { headers: { token } });
      toast.success("Role permissions updated.");
      setDialog(null);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Role permissions could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const toggleRole = async (role) => {
    const active = !role.isActive;
    if (!window.confirm(`${active ? "Activate" : "Deactivate"} the ${role.name} role? ${active ? "Assigned users will regain its permissions." : "Assigned users will lose its permissions immediately."}`)) return;
    try {
      await axios.patch(`${backendUrl}/api/admin/access/roles/${role.id}/status`, { active }, { headers: { token } });
      toast.success(`Role ${active ? "activated" : "deactivated"}.`);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      toast.error(errorMessage(requestError, "Role status could not be changed."));
    }
  };

  const togglePermission = (id) => {
    setSelectedPermissionIds((current) => current.includes(id)
      ? current.filter((permissionId) => permissionId !== id)
      : [...current, id]);
  };

  const groupedPermissions = permissionList.reduce((groups, permission) => {
    (groups[permission.group] ||= []).push(permission);
    return groups;
  }, {});

  if (!mayRead) return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to view Admin roles.</div>;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Access control</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Admin roles</h1>
          <p className="mt-1 text-sm text-slate-500">Roles apply only to Admin accounts; permissions are enforced by the API.</p>
        </div>
        {can("access:roles_create") && <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={16} /> Create role</button>}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-slate-500">{pagination?.total ?? 0} roles</span>
          <label className="relative block w-full sm:max-w-sm"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search role name or description" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label>
        </div>
        {error && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 font-semibold">Role</th><th className="px-4 py-3 font-semibold">Users</th><th className="px-4 py-3 font-semibold">Permissions</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan="5" className="px-4 py-12 text-center text-slate-500">Loading roles...</td></tr>}
              {!loading && !error && roles.length === 0 && <tr><td colSpan="5" className="px-4 py-14 text-center text-slate-500">No roles found.</td></tr>}
              {!loading && roles.map((role) => {
                const assignedToActor = actorRoleIds.has(role.id);
                const locked = role.isSystemRole || assignedToActor;
                return (
                  <tr key={role.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3.5"><div className="flex items-center gap-2 font-semibold text-slate-900">{role.name}{role.isSystemRole && <LockKeyhole size={14} className="text-amber-600" />}</div><div className="mt-0.5 font-mono text-[11px] text-slate-500">{role.code} · {role.portalScope}</div>{role.description && <div className="mt-1 max-w-lg text-xs text-slate-500">{role.description}</div>}</td>
                    <td className="px-4 py-3.5 text-slate-700">{role.userCount}</td>
                    <td className="px-4 py-3.5 text-slate-700">{role.permissionCount}</td>
                    <td className="px-4 py-3.5"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${role.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{role.isActive ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-3.5"><div className="flex justify-end gap-1">
                      {can("access:roles_assign_permissions") && <button type="button" title="Manage permissions" aria-label={`Manage permissions for ${role.name}`} onClick={() => openPermissions(role)} disabled={role.isSystemRole || assignedToActor} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"><ShieldCheck size={16} /></button>}
                      {can("access:roles_update") && <button type="button" title="Edit role" aria-label={`Edit ${role.name}`} onClick={() => openEdit(role)} disabled={locked} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"><Pencil size={16} /></button>}
                      {can("access:roles_deactivate") && <button type="button" title={role.isActive ? "Deactivate role" : "Activate role"} aria-label={`${role.isActive ? "Deactivate" : "Activate"} ${role.name}`} onClick={() => toggleRole(role)} disabled={locked} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35">{role.isActive ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}</button>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pagination && <div className="border-t border-slate-100 px-4"><Pagination page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} limit={pagination.limit} onPageChange={setPage} loading={loading} /></div>}
      </section>

      {(dialog?.type === "create" || dialog?.type === "edit") && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form onSubmit={submitRole} className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">{dialog.type === "create" ? "Create Admin role" : "Edit role"}</h2><button type="button" aria-label="Close" onClick={() => setDialog(null)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">×</button></div><label className="mt-5 block text-xs font-semibold text-slate-600">Role name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label><label className="mt-4 block text-xs font-semibold text-slate-600">Description<textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900" /></label><div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setDialog(null)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700">Cancel</button><button disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save role"}</button></div></form></div>}

      {dialog?.type === "permissions" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={savePermissions} className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">Role permissions</h2><p className="mt-0.5 text-xs text-slate-500">{dialog.role.name} · Admin portal</p></div><button type="button" aria-label="Close" onClick={() => setDialog(null)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">×</button></header>
            <div className="border-b border-slate-100 p-4"><label className="relative block"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} placeholder="Search permission code or description" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" /></label><p className="mt-2 text-xs text-slate-500">{selectedPermissionIds.length} selected</p></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {permissionLoading && <p className="py-8 text-center text-sm text-slate-500">Loading permissions...</p>}
              {!permissionLoading && permissionList.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No permissions match this search.</p>}
              {!permissionLoading && Object.entries(groupedPermissions).map(([group, permissions]) => <fieldset key={group} className="mb-4"><legend className="mb-1 text-xs font-bold uppercase text-slate-500">{group}</legend><div className="divide-y divide-slate-100 rounded-lg border border-slate-200">{permissions.map((permission) => {
                const selected = selectedPermissionIds.includes(permission.id);
                return <label key={permission.id} className={`flex items-start gap-3 px-3 py-2.5 ${permission.adminAssignable || selected ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed bg-slate-50 opacity-60"}`}><input type="checkbox" checked={selected} disabled={!permission.adminAssignable && !selected} onChange={() => togglePermission(permission.id)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600" /><span className="min-w-0"><span className="block font-mono text-xs font-semibold text-slate-800">{permission.code}</span><span className="mt-0.5 block text-xs text-slate-500">{permission.description || "No description"}</span></span><span className="ml-auto whitespace-nowrap text-[10px] text-slate-400">{permission.adminAssignable ? `${permission.adminRoleCount} roles` : selected ? "Remove legacy grant" : "Other portal"}</span></label>;
              })}</div></fieldset>)}
              {permissionPagination && <Pagination page={permissionPagination.page} totalPages={permissionPagination.totalPages} total={permissionPagination.total} limit={permissionPagination.limit} onPageChange={setPermissionPage} loading={permissionLoading} />}
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button type="button" onClick={() => setDialog(null)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700">Cancel</button><button disabled={saving || permissionLoading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save permissions"}</button></footer>
          </form>
        </div>
      )}
    </div>
  );
};

export default AccessRoles;