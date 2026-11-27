/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { CheckCircle2, LoaderCircle, RefreshCw, Truck } from "lucide-react";
import { backendUrl } from "../App";
import { usePermissions } from "../auth/PermissionsContext";

const AccessDrivers = ({ token }) => {
  const { can } = usePermissions();
  const [distributors, setDistributors] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [distributorId, setDistributorId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [email, setEmail] = useState("");
  const [loadingDistributors, setLoadingDistributors] = useState(true);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadDrivers = useCallback(async (selectedDistributorId) => {
    if (!selectedDistributorId || !token) {
      setDrivers([]);
      return;
    }
    setLoadingDrivers(true);
    setError("");
    try {
      const response = await axios.get(`${backendUrl}/api/admin/access/driver-provisioning/drivers`, {
        params: { distributorId: selectedDistributorId },
        headers: { token },
      });
      setDrivers(response.data.drivers || []);
      setDriverId("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load eligible drivers.");
      setDrivers([]);
    } finally {
      setLoadingDrivers(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const loadDistributors = async () => {
      if (!token || !can("access:driver_users_manage")) {
        setLoadingDistributors(false);
        return;
      }
      try {
        const response = await axios.get(`${backendUrl}/api/admin/access/driver-provisioning/distributors`, { headers: { token } });
        if (active) setDistributors(response.data.distributors || []);
      } catch (requestError) {
        if (active) setError(requestError.response?.data?.message || "Could not load active distributors.");
      } finally {
        if (active) setLoadingDistributors(false);
      }
    };
    loadDistributors();
    return () => { active = false; };
  }, [token, can]);

  const provision = async (event) => {
    event.preventDefault();
    if (!distributorId || !driverId || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await axios.post(`${backendUrl}/api/admin/access/driver-provisioning/accounts`, {
        distributorId,
        driverId,
        email: email.trim(),
      }, { headers: { token } });
      setSuccess(response.data.message || "Driver workspace account created.");
      setEmail("");
      await loadDrivers(distributorId);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not create the driver workspace account.");
    } finally {
      setSaving(false);
    }
  };

  if (!can("access:driver_users_manage")) {
    return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to provision driver accounts.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Access Control</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">Driver workspace access</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Link an existing active distributor driver to a restricted driver login. Drivers only receive assigned-delivery access.</p>
        </div>
        <button type="button" onClick={() => loadDrivers(distributorId)} disabled={!distributorId || loadingDrivers} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loadingDrivers ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <form onSubmit={provision} className="space-y-4">
          <label className="block text-sm font-semibold text-slate-800">
            Distributor workspace
            <select required value={distributorId} onChange={(event) => {
              const nextId = event.target.value;
              setDistributorId(nextId);
              setDriverId("");
              setSuccess("");
              loadDrivers(nextId);
            }} disabled={loadingDistributors} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
              <option value="">{loadingDistributors ? "Loading distributors…" : "Select an active distributor"}</option>
              {distributors.map((distributor) => <option key={distributor.id} value={distributor.id}>{distributor.name} — {distributor.district}, {distributor.province}</option>)}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            Unlinked active driver
            <select required value={driverId} onChange={(event) => setDriverId(event.target.value)} disabled={!distributorId || loadingDrivers} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
              <option value="">{loadingDrivers ? "Loading drivers…" : drivers.length ? "Select a driver" : "No unlinked active drivers"}</option>
              {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name} · {driver.phone}{driver.vehicleRegistration ? ` · ${driver.vehicleRegistration}` : ""}</option>)}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-800">
            Driver email
            <input required type="email" autoComplete="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>

          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          {success && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{success}</p>}

          <div className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            <p className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" /> Secure first sign-in</p>
            <p className="mt-1">No password is shown or sent by this page. In development and test, the driver can choose <strong>Forgot password</strong> and verify the registered email and phone. Production recovery requires an explicit server-side feature flag; admin driver provisioning remains disabled until HTTPS SMS delivery, shared rate limiting, staging recovery checks, and documented recovery operations have been verified.</p>
          </div>

          <button type="submit" disabled={saving || loadingDrivers || !driverId} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 font-bold text-white disabled:opacity-50 sm:w-auto">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {saving ? "Creating restricted account…" : "Create driver login"}
          </button>
        </form>
      </section>
    </div>
  );
};

export default AccessDrivers;
