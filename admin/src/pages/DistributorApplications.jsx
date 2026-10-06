import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL;

const DistributorApplications = ({ token }) => {
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${backendUrl}/api/distributor/admin/applications`, {
        params: status ? { status } : {},
        headers: { Authorization: `Bearer ${token}` },
      });
      setApplications(response.data.applications || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Distributor applications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [status, token]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const reviewApplication = async (application, nextStatus) => {
    setUpdatingId(application.id);
    setError("");
    try {
      await axios.patch(
        `${backendUrl}/api/distributor/admin/applications/${application.id}/review`,
        { status: nextStatus },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Distributor status could not be updated.");
    } finally {
      setUpdatingId("");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Distributor Applications</h1>
          <p className="mt-1 text-sm text-slate-500">Review registrations and manage approved distributor access.</p>
        </div>
        <select
          aria-label="Filter applications by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All statuses</option>
        </select>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Business / Contact</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Applied</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">Loading applications…</td></tr>
            ) : applications.length === 0 ? (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">No applications found.</td></tr>
            ) : applications.map((application) => (
              <tr key={application.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{application.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{application.account?.email || "—"}</div>
                  <div className="text-xs">{application.phone || application.account?.phone || "—"}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{[application.city, application.address].filter(Boolean).join(", ") || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{new Date(application.appliedAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{application.status.replaceAll("_", " ")}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {application.status === "PENDING_APPROVAL" && (
                      <>
                        <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "ACTIVE")} className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Approve</button>
                        <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "REJECTED")} className="rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Reject</button>
                      </>
                    )}
                    {application.status === "ACTIVE" && (
                      <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "SUSPENDED")} className="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-50">Suspend</button>
                    )}
                    {application.status === "SUSPENDED" && (
                      <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "ACTIVE")} className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Reactivate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default DistributorApplications;
