import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { MapPinned, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getBranchesForLocation, getDistrictsForProvince, useLocationLookups } from "../utils/locationLookups";
import { usePermissions } from "../auth/PermissionsContext";

const backendUrl = import.meta.env.VITE_BACKEND_URL;

const DistributorApplications = ({ token }) => {
  const navigate = useNavigate();
  const { lookups: locationLookups, lookupError } = useLocationLookups(backendUrl);
  const { can } = usePermissions();
  const canEditCoverage = can("distributor:admin_review");
  const canResolveSettlements = can("finance:payable_settle");
  const [activeTab, setActiveTab] = useState("applications");
  const [status, setStatus] = useState("PENDING_APPROVAL");
  const [applications, setApplications] = useState([]);
  const [manufacturerRequestStatus, setManufacturerRequestStatus] = useState("REQUESTED");
  const [manufacturerRequests, setManufacturerRequests] = useState([]);
  const [manufacturerRequestsLoading, setManufacturerRequestsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [editingDistributor, setEditingDistributor] = useState(null);
  const [distributorForm, setDistributorForm] = useState(null);
  const [savingDistributorProfile, setSavingDistributorProfile] = useState(false);
  const [coverageDistributors, setCoverageDistributors] = useState([]);
  const [coverageAreas, setCoverageAreas] = useState([]);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageSaving, setCoverageSaving] = useState(false);
  const [selectedCoverageDistributorId, setSelectedCoverageDistributorId] = useState("");
  const [selectedCoverageProvince, setSelectedCoverageProvince] = useState("");
  const [selectedCoveragePairs, setSelectedCoveragePairs] = useState(new Set());

  // Rate Cards state
  const [ratesList, setRatesList] = useState([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [selectedDistributorForRate, setSelectedDistributorForRate] = useState(null);
  const [rateForm, setRateForm] = useState({
    deliveryCharge: 100,
    returnCharge: 50,
    commissionRate: 0,
    vatRate: 13,
    vatInclusive: false,
  });

  // Settlements state
  const [settlements, setSettlements] = useState([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [reconciliationRequest, setReconciliationRequest] = useState(null);
  const [reconciliationDecision, setReconciliationDecision] = useState("RECONCILE");
  const [selectedEarningDocumentIds, setSelectedEarningDocumentIds] = useState([]);
  const [reconciliationNotes, setReconciliationNotes] = useState("");
  const [savingReconciliation, setSavingReconciliation] = useState(false);
  const editDistributorProvince = distributorForm?.province;
  const editDistributorDistrict = distributorForm?.district;
  const editDistributorCity = distributorForm?.city;
  const editDistributorStreet = distributorForm?.street;
  const distributorNcmBranches = getBranchesForLocation(locationLookups, editDistributorProvince, editDistributorDistrict)
    .map(({ name }) => name);
  const selectedNcmBranch = locationLookups?.branches?.find(
    (branch) => branch.name.toLocaleLowerCase() === String(editDistributorCity || "").toLocaleLowerCase(),
  );
  const distributorCoveredAreas = selectedNcmBranch?.coveredAreas || [];
  const loadingDistributorBranches = !locationLookups && !lookupError;

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

  const loadManufacturerRequests = useCallback(async () => {
    setManufacturerRequestsLoading(true);
    setError("");
    try {
      const response = await axios.get(`${backendUrl}/api/admin/distributor-applications`, {
        params: { status: manufacturerRequestStatus },
        headers: { Authorization: `Bearer ${token}` },
      });
      setManufacturerRequests(response.data.applications || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Manufacturer distributor requests could not be loaded.");
    } finally {
      setManufacturerRequestsLoading(false);
    }
  }, [manufacturerRequestStatus, token]);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    setError("");
    try {
      const response = await axios.get(`${backendUrl}/api/admin/distributor-applications/coverage`, {
        headers: { token },
      });
      const activeDistributors = (response.data.distributors || []).filter(
        (distributor) => distributor.status === "ACTIVE" && distributor.isActive
      );
      setCoverageDistributors(activeDistributors);
      setCoverageAreas(response.data.locations || []);
      setSelectedCoverageDistributorId((current) =>
        activeDistributors.some((distributor) => distributor.id === current)
          ? current
          : activeDistributors[0]?.id || ""
      );
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Distributor coverage could not be loaded.");
    } finally {
      setCoverageLoading(false);
    }
  }, [token]);

  const loadRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/admin/distributor-rates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRatesList(response.data?.rateCards || []);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to load rate cards.");
    } finally {
      setRatesLoading(false);
    }
  }, [token]);

  const loadSettlements = useCallback(async () => {
    setSettlementsLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/admin/distributor-finance/settlements`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSettlements(response.data?.settlements || []);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to load settlements.");
    } finally {
      setSettlementsLoading(false);
    }
  }, [token]);

  const openSettlementReconciliation = (request) => {
    setReconciliationRequest(request);
    setReconciliationDecision("RECONCILE");
    setSelectedEarningDocumentIds([]);
    setReconciliationNotes("");
  };

  const resolveSettlementReconciliation = async (event) => {
    event.preventDefault();
    if (!reconciliationRequest || !reconciliationNotes.trim()) {
      toast.error("Add review notes before resolving this request.");
      return;
    }
    if (reconciliationDecision === "RECONCILE" && selectedEarningDocumentIds.length === 0) {
      toast.error("Select verified earning documents to reconcile this request.");
      return;
    }
    if (
      reconciliationDecision === "REJECT" &&
      !window.confirm("Reject this legacy settlement request? This does not create or change any accounting earning.")
    ) return;

    setSavingReconciliation(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/admin/distributor-finance/settlements/${reconciliationRequest.id}/resolve-reconciliation`,
        {
          decision: reconciliationDecision,
          earningDocumentIds: selectedEarningDocumentIds,
          reviewNotes: reconciliationNotes.trim(),
        },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Settlement reconciliation failed.");
      toast.success(reconciliationDecision === "RECONCILE"
        ? "Verified earning documents linked to the settlement request."
        : "Unsupported settlement request rejected with an audit record.");
      setReconciliationRequest(null);
      await loadSettlements();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || requestError.message || "Settlement reconciliation failed.");
    } finally {
      setSavingReconciliation(false);
    }
  };

  useEffect(() => {
    if (activeTab === "applications") loadApplications();
    if (activeTab === "manufacturer-requests") loadManufacturerRequests();
    if (activeTab === "coverage") loadCoverage();
    if (activeTab === "rates") {
      loadApplications();
      loadRates();
    }
    if (activeTab === "settlements") loadSettlements();
  }, [activeTab, loadApplications, loadManufacturerRequests, loadCoverage, loadRates, loadSettlements]);

  useEffect(() => {
    const selectedDistributor = coverageDistributors.find(
      (distributor) => distributor.id === selectedCoverageDistributorId
    );
    setSelectedCoveragePairs(new Set(
      (selectedDistributor?.locations || []).map((location) => `${location.province}|${location.district}`)
    ));
  }, [coverageDistributors, selectedCoverageDistributorId]);

  useEffect(() => {
    if (!locationLookups || !editDistributorProvince || !editDistributorDistrict) return;
    if (distributorNcmBranches.length > 0 && !distributorNcmBranches.some((branch) => branch.toLocaleLowerCase() === editDistributorCity?.toLocaleLowerCase())) {
      setDistributorForm((current) => current ? {
        ...current,
        city: distributorNcmBranches[0],
        ncmPickupBranch: distributorNcmBranches[0],
        street: "",
      } : current);
    }
  }, [locationLookups, editDistributorProvince, editDistributorDistrict, distributorNcmBranches, editDistributorCity]);

  useEffect(() => {
    if (!locationLookups || !distributorCoveredAreas.length) return;
    if (!distributorCoveredAreas.some((area) => area.toLocaleLowerCase() === editDistributorStreet?.toLocaleLowerCase())) {
      setDistributorForm((current) => current ? { ...current, street: distributorCoveredAreas[0] } : current);
    }
  }, [locationLookups, editDistributorCity, distributorCoveredAreas, editDistributorStreet]);

  const reviewApplication = async (application, nextStatus) => {
    setUpdatingId(application.id);
    setError("");
    try {
      await axios.patch(
        `${backendUrl}/api/distributor/admin/applications/${application.id}/review`,
        { status: nextStatus },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(`Application marked as ${nextStatus}`);
      await loadApplications();
    } catch (requestError) {
      const msg = requestError.response?.data?.message || "Distributor status could not be updated.";
      setError(msg);
      toast.error(msg);
    } finally {
      setUpdatingId("");
    }
  };

  const editDistributor = (application) => {
    const toDateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";
    setError("");
    setEditingDistributor(application);
    setDistributorForm({
      name: application.name || "",
      email: application.account?.email || "",
      phone: application.phone || application.account?.phone || "",
      province: application.province || "Bagmati Province",
      district: application.district || "Kathmandu",
      city: application.city || application.ncmPickupBranch || "",
      street: application.street || "",
      landmark: application.landmark || "",
      address: application.address || "",
      ncmPickupBranch: application.ncmPickupBranch || application.city || "",
      pickupBranchStatus: application.pickupBranchStatus || "UNVERIFIED",
      pickupAddress: application.pickupAddress || "",
      pickupContactName: application.pickupContactName || "",
      pickupContactPhone: application.pickupContactPhone || "",
      pickupWindow: application.pickupWindow || "",
      returnInstructions: application.returnInstructions || "",
      contractStartDate: toDateInput(application.contractStartDate),
      contractExpiryDate: toDateInput(application.contractExpiryDate),
    });
  };

  const saveDistributorProfile = async (event) => {
    event.preventDefault();
    if (!editingDistributor || !distributorForm) return;
    setSavingDistributorProfile(true);
    setError("");
    try {
      const response = await axios.put(
        `${backendUrl}/api/admin/distributor-applications/${editingDistributor.id}/profile`,
        {
          ...distributorForm,
          ncmPickupBranch: distributorForm.city || distributorForm.ncmPickupBranch,
          address: distributorForm.address || [
            distributorForm.street,
            distributorForm.landmark,
            distributorForm.city,
            distributorForm.district,
            distributorForm.province,
          ].filter(Boolean).join(", "),
          pickupAddress: distributorForm.pickupAddress || [
            distributorForm.street,
            distributorForm.landmark,
            distributorForm.city,
          ].filter(Boolean).join(", "),
        },
        { headers: { token } },
      );
      if (!response.data.success) throw new Error(response.data.message || "Distributor profile could not be updated.");
      toast.success("Distributor profile updated.");
      setEditingDistributor(null);
      setDistributorForm(null);
      await loadApplications();
    } catch (requestError) {
      const message = requestError.response?.data?.message || requestError.message || "Distributor profile could not be updated.";
      setError(message);
      toast.error(message);
    } finally {
      setSavingDistributorProfile(false);
    }
  };

  const reviewManufacturerRequest = async (application, nextStatus) => {
    setUpdatingId(application.id);
    setError("");
    try {
      await axios.patch(
        `${backendUrl}/api/admin/distributor-applications/${application.id}`,
        { status: nextStatus },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      toast.success(`Manufacturer distributor request ${nextStatus.toLowerCase()}.`);
      await loadManufacturerRequests();
    } catch (requestError) {
      const msg = requestError.response?.data?.message || "Manufacturer distributor request could not be reviewed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setUpdatingId("");
    }
  };

  const toggleCoveragePair = (province, district) => {
    const key = `${province}|${district}`;
    setSelectedCoveragePairs((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveCoverage = async () => {
    if (!selectedCoverageDistributorId) {
      toast.error("Select an active distributor first.");
      return;
    }
    setCoverageSaving(true);
    try {
      const locations = [...selectedCoveragePairs].map((key) => {
        const [province, district] = key.split("|");
        return { province, district };
      });
      const response = await axios.put(
        `${backendUrl}/api/admin/distributor-applications/${selectedCoverageDistributorId}/coverage`,
        { locations },
        { headers: { token } },
      );
      setCoverageDistributors((current) => current.map((distributor) =>
        distributor.id === selectedCoverageDistributorId
          ? { ...distributor, locations: response.data.locations || [] }
          : distributor
      ));
      toast.success("Distributor service-area coverage saved.");
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Distributor coverage could not be saved.");
    } finally {
      setCoverageSaving(false);
    }
  };

  const handleSaveRateCard = async (e) => {
    e.preventDefault();
    if (!selectedDistributorForRate) {
      toast.error("Please select a distributor first");
      return;
    }
    try {
      await axios.post(
        `${backendUrl}/api/admin/distributor-rates`,
        {
          distributorId: selectedDistributorForRate.id,
          ...rateForm,
          status: "APPROVED",
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(`A new rate-card version was saved for ${selectedDistributorForRate.name}`);
      loadRates();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update rates");
    }
  };

  const expireRateCard = async (rateCard) => {
    if (!window.confirm("Close this rate card? Past earnings will remain unchanged.")) return;
    try {
      await axios.delete(`${backendUrl}/api/admin/distributor-rates/${rateCard.id}`, {
        headers: { token },
      });
      toast.success("Rate card closed; its history was retained.");
      loadRates();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || "Rate card could not be closed.");
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Distributor Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review partner authorizations, negotiate custom delivery rates, and approve financial settlements.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium">
          <button
            onClick={() => setActiveTab("applications")}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === "applications" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900"}`}
          >
            Distributor applications ({applications.length})
          </button>
          <button
            onClick={() => setActiveTab("manufacturer-requests")}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === "manufacturer-requests" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900"}`}
          >
            Manufacturer requests
          </button>
          {canEditCoverage && (
            <button
              onClick={() => setActiveTab("coverage")}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === "coverage" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900"}`}
            >
              Service-area coverage
            </button>
          )}
          <button
            onClick={() => setActiveTab("rates")}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === "rates" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900"}`}
          >
            Delivery Rate Cards & Target Bonus Plans
          </button>
          <button
            onClick={() => setActiveTab("settlements")}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${activeTab === "settlements" ? "bg-white text-slate-900 shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900"}`}
          >
            Settlement Requests ({settlements.filter((s) => ["PENDING", "PARTIALLY_PAID"].includes(s.status)).length})
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {/* TAB 1: APPLICATIONS */}
      {activeTab === "applications" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <select
              aria-label="Filter applications by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm"
            >
              <option value="PENDING_APPROVAL">Pending approval</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REJECTED">Rejected</option>
              <option value="">All statuses</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3">Business Name</th>
                  <th className="px-4 py-3">Contact Details</th>
                  <th className="px-4 py-3">Location & Service Area</th>
                  <th className="px-4 py-3">Applied Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">Loading applications…</td></tr>
                ) : applications.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">No applications found for this filter.</td></tr>
                ) : applications.map((application) => (
                  <tr key={application.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-900">{application.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{application.account?.email || "—"}</div>
                      <div className="text-xs text-slate-500">{application.phone || application.account?.phone || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{[application.city, application.address].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{new Date(application.appliedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        application.status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : application.status === "PENDING_APPROVAL"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}>
                        {application.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canEditCoverage && (
                          <button onClick={() => editDistributor(application)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                        )}
                        {application.status === "PENDING_APPROVAL" && (
                          <>
                            <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "ACTIVE")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50">Approve</button>
                            <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "REJECTED")} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 shadow-sm transition disabled:opacity-50">Reject</button>
                          </>
                        )}
                        {application.status === "ACTIVE" && (
                          <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "SUSPENDED")} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition disabled:opacity-50">Suspend</button>
                        )}
                        {application.status === "SUSPENDED" && (
                          <button disabled={updatingId === application.id} onClick={() => reviewApplication(application, "ACTIVE")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50">Reactivate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "manufacturer-requests" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Review manufacturers requesting access to operate a distributor hub. Approval creates a separate distributor profile for the same account.
            </p>
            <select
              aria-label="Filter manufacturer distributor requests by status"
              value={manufacturerRequestStatus}
              onChange={(event) => setManufacturerRequestStatus(event.target.value)}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm"
            >
              <option value="REQUESTED">Pending review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3">Manufacturer</th>
                  <th className="px-4 py-3">Contact details</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Requested</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {manufacturerRequestsLoading ? (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">Loading manufacturer requests…</td></tr>
                ) : manufacturerRequests.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">No manufacturer distributor requests found for this status.</td></tr>
                ) : manufacturerRequests.map((application) => (
                  <tr key={application.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-900">{application.name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{application.account?.email || "—"}</div>
                      <div className="text-xs text-slate-500">{application.phone || application.account?.phone || "—"}</div>
                      {application.pickupContactName && <div className="mt-1 text-xs text-slate-500">Pickup: {application.pickupContactName}{application.pickupContactPhone ? ` · ${application.pickupContactPhone}` : ""}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{[application.city, application.address].filter(Boolean).join(", ") || "—"}</div>
                      {application.locations?.length > 0 && (
                        <div className="mt-1 text-xs text-slate-500">
                          {application.locations.map((location) => `${location.district}, ${location.province}`).join(" · ")}
                        </div>
                      )}
                      {application.pickupAddress && <div className="mt-1 text-xs text-slate-500">Pickup: {application.pickupAddress}</div>}
                      {application.ncmPickupBranch && <div className="mt-1 text-xs text-slate-500">NCM: {application.ncmPickupBranch}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{new Date(application.updatedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        application.distributorApplicationStatus === "REQUESTED"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : application.distributorApplicationStatus === "APPROVED"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}>
                        {application.distributorApplicationStatus.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {application.distributorApplicationStatus === "REQUESTED" && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            disabled={updatingId === application.id}
                            onClick={() => reviewManufacturerRequest(application, "APPROVED")}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={updatingId === application.id}
                            onClick={() => reviewManufacturerRequest(application, "REJECTED")}
                            className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 shadow-sm transition disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "coverage" && canEditCoverage && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <MapPinned className="h-5 w-5" />
            Distributor service-area coverage
          </h2>
          {lookupError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{lookupError}</p>}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-64 flex-1">
              <label htmlFor="coverage-distributor" className="mb-1 block text-sm font-semibold text-slate-700">
                Active distributor
              </label>
              <select
                id="coverage-distributor"
                value={selectedCoverageDistributorId}
                onChange={(event) => setSelectedCoverageDistributorId(event.target.value)}
                disabled={coverageLoading || coverageDistributors.length === 0}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {coverageDistributors.length === 0 && <option value="">No active distributors</option>}
                {coverageDistributors.map((distributor) => (
                  <option key={distributor.id} value={distributor.id}>
                    {distributor.name}{distributor.city ? ` — ${distributor.city}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-56 flex-1">
              <label htmlFor="coverage-province" className="mb-1 block text-sm font-semibold text-slate-700">
                Province
              </label>
              <select
                id="coverage-province"
                value={selectedCoverageProvince}
                onChange={(event) => setSelectedCoverageProvince(event.target.value)}
                disabled={coverageLoading || !locationLookups}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Choose a province</option>
                {(locationLookups?.provinces || []).map((province) => (
                  <option key={province} value={province}>{province}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={saveCoverage}
              disabled={coverageLoading || coverageSaving || !selectedCoverageDistributorId}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {coverageSaving ? "Saving..." : "Save coverage"}
            </button>
          </div>

          <p className="text-sm text-slate-500">
            Select the exact districts this distributor serves. Checkout allocation also requires the distributor to have every ordered variant in available ledger stock.
          </p>

          {coverageLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading distributor coverage...</p>
          ) : !selectedCoverageDistributorId ? (
            <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
              Approve a distributor before configuring its service area.
            </p>
          ) : !selectedCoverageProvince ? (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Choose a province to manage its covered districts.
            </p>
          ) : (
            <div className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {getDistrictsForProvince(locationLookups, selectedCoverageProvince).map((district) => {
                const canonicalDistrict = district === "Nawalparasi West" ? "Parasi" : district;
                const key = `${selectedCoverageProvince}|${canonicalDistrict}`;
                const isSupportedLocation = coverageAreas.some(
                  (area) => area.type === "DISTRICT" && area.name === canonicalDistrict && area.province === selectedCoverageProvince
                );
                if (!isSupportedLocation) return null;
                return (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selectedCoveragePairs.has(key)}
                      onChange={() => toggleCoveragePair(selectedCoverageProvince, canonicalDistrict)}
                    />
                    {district}
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-500">
            {selectedCoveragePairs.size} district{selectedCoveragePairs.size === 1 ? "" : "s"} selected.
          </p>
        </div>
      )}

      {/* TAB 2: RATE CARDS */}
      {activeTab === "rates" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Configured Delivery Rate Cards</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Distributor</th>
                      <th className="px-4 py-3">Delivery / Return</th>
                      <th className="px-4 py-3">Commission deduction</th>
                      <th className="px-4 py-3">Effective Period</th>
                      <th className="px-4 py-3">Status / VAT</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ratesLoading ? (
                      <tr><td colSpan="6" className="px-4 py-6 text-center text-slate-500">Loading rates...</td></tr>
                    ) : ratesList.length === 0 ? (
                      <tr><td colSpan="6" className="px-4 py-6 text-center text-slate-500">No custom rate cards saved yet. Default fallback applies.</td></tr>
                    ) : (
                      ratesList.map((rate) => (
                        <tr key={rate.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3 font-semibold text-slate-900">{rate.distributor?.name || rate.distributorId}</td>
                          <td className="px-4 py-3 text-slate-700 font-medium">
                            Rs {Number(rate.deliveryCharge).toFixed(2)} / Rs {Number(rate.returnCharge).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {Number(rate.commissionRate).toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {rate.effectiveFrom ? new Date(rate.effectiveFrom).toLocaleDateString() : "—"} – {rate.effectiveUntil ? new Date(rate.effectiveUntil).toLocaleDateString() : "Open"}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {rate.status} · No input VAT without verified invoice
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => {
                                setSelectedDistributorForRate(rate.distributor);
                                setRateForm({
                                  deliveryCharge: Number(rate.deliveryCharge),
                                  returnCharge: Number(rate.returnCharge),
                                  commissionRate: Number(rate.commissionRate),
                                  vatRate: Number(rate.vatRate ?? 13),
                                  vatInclusive: Boolean(rate.vatInclusive),
                                });
                              }}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                            >
                              Revise
                            </button>
                            <button
                              onClick={() => expireRateCard(rate)}
                              disabled={!canEditCoverage || !["APPROVED", "PENDING"].includes(rate.status)}
                              className="ml-3 text-xs font-semibold text-rose-600 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Close
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Set Rates Form */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-slate-900">
                {selectedDistributorForRate ? `Edit Rates: ${selectedDistributorForRate.name}` : "Configure Rate Card"}
              </h2>
              
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Select Active Distributor</label>
                  <select
                    value={selectedDistributorForRate?.id || ""}
                    onChange={(e) => {
                      const found = applications.find((a) => a.id === e.target.value);
                      setSelectedDistributorForRate(found || null);
                    }}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm bg-white"
                  >
                    <option value="">-- Choose Distributor --</option>
                    {applications.filter((a) => a.status === "ACTIVE").map((dist) => (
                      <option key={dist.id} value={dist.id}>
                        {dist.name} ({dist.city || "Hub"})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 font-medium mb-0.5">Delivery earning (NPR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rateForm.deliveryCharge}
                      onChange={(e) => setRateForm({ ...rateForm, deliveryCharge: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-0.5">Return service earning (NPR)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rateForm.returnCharge}
                      onChange={(e) => setRateForm({ ...rateForm, returnCharge: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 font-medium mb-0.5">Commission (% of delivery earning)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={rateForm.commissionRate}
                      onChange={(e) => setRateForm({ ...rateForm, commissionRate: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                    />
                  </div>
                </div>

                <p className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">This card controls fixed delivery and return charges only. Per-delivery incentives are disabled. Configure monthly target tiers from the distributor profile.</p>
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">No recoverable input VAT is claimed on distributor service payments unless a verified eligible tax invoice is supported by the accounting workflow.</p>

                <button
                  onClick={handleSaveRateCard}
                  className="w-full mt-3 bg-slate-900 text-white rounded-lg py-2.5 font-semibold text-xs hover:bg-black transition shadow-sm"
                >
                  Save Negotiated Rate Card
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SETTLEMENT REQUESTS */}
      {activeTab === "settlements" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3">Distributor</th>
                  <th className="px-4 py-3">Gross Earnings</th>
                  <th className="px-4 py-3">Incentives / Target bonus / Charges</th>
                  <th className="px-4 py-3">VAT</th>
                  <th className="px-4 py-3">Net Payable</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {settlementsLoading ? (
                  <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">Loading settlements...</td></tr>
                ) : settlements.length === 0 ? (
                  <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">No settlement requests found.</td></tr>
                ) : (
                  settlements.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div>{req.distributor?.name || req.distributorId}</div>
                        <div className="text-xs text-slate-500">{new Date(req.createdAt).toLocaleDateString()}</div>
                        {req.metadata?.statementSnapshot?.lineItems?.length > 0 && (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer font-semibold text-indigo-700">View unit-level settlement log</summary>
                            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
                              <table className="w-full text-left text-[10px]">
                                <thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">Delivery / period</th><th className="p-2 text-right">Charge</th><th className="p-2 text-right">Incentive</th><th className="p-2 text-right">Bonus</th><th className="p-2 text-right">Deduction</th><th className="p-2 text-right">Net</th></tr></thead>
                                <tbody>{req.metadata.statementSnapshot.lineItems.map((line, index) => (
                                  <tr key={`${line.referenceId}-${index}`} className="border-t border-slate-100">
                                    <td className="p-2">{line.type === "BONUS" ? `${line.referenceId} · ${line.eligibleDeliveryCount} deliveries` : `${line.type} · ${line.referenceId}`}</td>
                                    <td className="p-2 text-right">Rs {Number(line.deliveryCharge || line.returnCharge || 0).toFixed(2)}</td>
                                    <td className="p-2 text-right">Rs {Number(line.incentiveAmount || 0).toFixed(2)}</td>
                                    <td className="p-2 text-right">Rs {Number(line.bonusAmount || 0).toFixed(2)}</td>
                                    <td className="p-2 text-right">Rs {Number(line.commissionDeduction || 0).toFixed(2)}</td>
                                    <td className="p-2 text-right font-semibold">Rs {Number(line.netAmount || 0).toFixed(2)}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-medium">Rs {req.grossEarnings?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div>+Rs {req.incentives} legacy incentive</div>
                        <div>+Rs {Number(req.bonuses || req.metadata?.statementSnapshot?.summary?.earnedBonuses || 0).toFixed(2)} target bonus</div>
                        <div>-Rs {req.chargesApplied} deductions</div>
                        <div className="text-slate-500">{req.metadata?.statementSnapshot?.lineItems?.filter((line) => line.type === "DELIVERY").length ?? "—"} delivery units</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">Rs {req.vatAmount}</td>
                      <td className="px-4 py-3 text-emerald-700 font-bold">Rs {req.netPayable?.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          req.status === "SETTLED" || req.status === "PAID"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : req.status === "PARTIALLY_PAID"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}>
                          {req.status}
                        </span>
                        {req.externalPaymentReference && <div className="mt-1 text-[10px] text-slate-500">Transfer ref: {req.externalPaymentReference}</div>}
                        {req.metadata?.settlementBasis === "LEGACY_EARNINGS_RECONCILIATION_REQUIRED" && (
                          <div className="mt-2 max-w-xs rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">
                            Accounting reconciliation required before payout; no payable was created from the requested amount.
                          </div>
                        )}
                        {Number(req.codExposureWarning?.outstandingReceivable || 0) > 0 && (
                          <div className="mt-2 max-w-xs rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-medium text-orange-800">
                            COD receivable Rs {Number(req.codExposureWarning.outstandingReceivable).toFixed(2)} remains outstanding
                            {Number(req.codExposureWarning.pendingRemittance || 0) > 0
                              ? `; Rs ${Number(req.codExposureWarning.pendingRemittance).toFixed(2)} is awaiting review`
                              : ""}. Service payout is gross; COD is not netted.
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {req.metadata?.settlementBasis === "LEGACY_EARNINGS_RECONCILIATION_REQUIRED" ? (
                          canResolveSettlements ? (
                            <button
                              onClick={() => openSettlementReconciliation(req)}
                              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              Review reconciliation
                            </button>
                          ) : <span className="text-xs font-medium text-amber-700">Finance permission required</span>
                        ) : req.status !== "SETTLED" && req.status !== "PAID" && req.status !== "REJECTED" && (
                          <button
                            onClick={() => navigate("/payables")}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-50"
                          >
                            Pay in Payables
                          </button>
                        )}
                        {(req.status === "SETTLED" || req.status === "PAID") && (
                          <span className="text-xs text-slate-400">Settled on {req.settledAt ? new Date(req.settledAt).toLocaleDateString() : "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingDistributor && distributorForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveDistributorProfile} className="max-h-[90vh] w-full max-w-3xl space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Edit distributor profile</h2>
                <p className="mt-1 text-xs text-slate-500">Update the registration details and NCM pickup information.</p>
              </div>
              <button type="button" onClick={() => { setEditingDistributor(null); setDistributorForm(null); }} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Close</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Business / Contact Name *
                <input required value={distributorForm.name} onChange={(event) => setDistributorForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Login Email *
                <input required type="email" value={distributorForm.email} onChange={(event) => setDistributorForm((current) => ({ ...current, email: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Official Contact Phone *
                <input required value={distributorForm.phone} onChange={(event) => setDistributorForm((current) => ({ ...current, phone: event.target.value.replace(/[^0-9]/g, "") }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Province *
                <select required value={distributorForm.province} disabled={!locationLookups} onChange={(event) => {
                  const province = event.target.value;
                  setDistributorForm((current) => ({ ...current, province, district: getDistrictsForProvince(locationLookups, province)[0] || "", city: "", ncmPickupBranch: "", street: "" }));
                }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {(locationLookups?.provinces || []).map((province) => <option key={province} value={province}>{province}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">District *
                <select required value={distributorForm.district} disabled={!locationLookups} onChange={(event) => setDistributorForm((current) => ({ ...current, district: event.target.value, city: "", ncmPickupBranch: "", street: "" }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {getDistrictsForProvince(locationLookups, distributorForm.province).map((district) => <option key={district} value={district}>{district}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">NCM Town / Branch *
                <select required value={distributorForm.city} onChange={(event) => setDistributorForm((current) => ({ ...current, city: event.target.value, ncmPickupBranch: event.target.value, street: "" }))} disabled={loadingDistributorBranches || distributorNcmBranches.length === 0} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
                  {distributorForm.city && !distributorNcmBranches.includes(distributorForm.city) && <option value={distributorForm.city}>{distributorForm.city}</option>}
                  {distributorNcmBranches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                  {!distributorForm.city && <option value="">{loadingDistributorBranches ? "Loading branches..." : "Select NCM Branch"}</option>}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Street / Covered Area *
                <select required value={distributorForm.street} onChange={(event) => setDistributorForm((current) => ({ ...current, street: event.target.value }))} disabled={!distributorCoveredAreas.length} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100">
                  <option value="">{distributorCoveredAreas.length ? "Select a covered area" : "No covered area available"}</option>
                  {distributorCoveredAreas.map((area) => <option key={area} value={area}>{area}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Nearest Landmark / Unit Details *
                <input required value={distributorForm.landmark} onChange={(event) => setDistributorForm((current) => ({ ...current, landmark: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Full Business / Warehouse Address
                <input value={distributorForm.address} onChange={(event) => setDistributorForm((current) => ({ ...current, address: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Pickup Warehouse Address
                <input value={distributorForm.pickupAddress} onChange={(event) => setDistributorForm((current) => ({ ...current, pickupAddress: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Pickup Contact Person
                <input value={distributorForm.pickupContactName} onChange={(event) => setDistributorForm((current) => ({ ...current, pickupContactName: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Pickup Contact Phone
                <input value={distributorForm.pickupContactPhone} onChange={(event) => setDistributorForm((current) => ({ ...current, pickupContactPhone: event.target.value.replace(/[^0-9]/g, "") }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">NCM Pickup Branch Status
                <select value={distributorForm.pickupBranchStatus} onChange={(event) => setDistributorForm((current) => ({ ...current, pickupBranchStatus: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="UNVERIFIED">UNVERIFIED</option>
                  <option value="VERIFIED">VERIFIED</option>
                  <option value="REJECTED">REJECTED</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700">Pickup Availability Window
                <input value={distributorForm.pickupWindow} onChange={(event) => setDistributorForm((current) => ({ ...current, pickupWindow: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Contract Start Date
                <input type="date" value={distributorForm.contractStartDate} onChange={(event) => setDistributorForm((current) => ({ ...current, contractStartDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Contract Expiry Date
                <input type="date" value={distributorForm.contractExpiryDate} onChange={(event) => setDistributorForm((current) => ({ ...current, contractExpiryDate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="block text-xs font-semibold text-slate-700">Return &amp; Defect Handling Instructions
              <textarea rows={3} value={distributorForm.returnInstructions} onChange={(event) => setDistributorForm((current) => ({ ...current, returnInstructions: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => { setEditingDistributor(null); setDistributorForm(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="submit" disabled={savingDistributorProfile} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {savingDistributorProfile ? "Saving..." : "Save profile"}
              </button>
            </div>
          </form>
        </div>
      )}
      {reconciliationRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={resolveSettlementReconciliation} className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Review legacy settlement</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {reconciliationRequest.distributor?.name || reconciliationRequest.distributorId} · requested Rs {Number(reconciliationRequest.amount || 0).toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-amber-700">Only link existing, open accounting earning documents. This action does not synthesize earnings.</p>
              </div>
              <button type="button" onClick={() => setReconciliationRequest(null)} className="text-sm font-semibold text-slate-500 hover:text-slate-900">Close</button>
            </div>
            <label className="block text-sm font-semibold text-slate-700">
              Decision
              <select
                value={reconciliationDecision}
                onChange={(event) => setReconciliationDecision(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="RECONCILE">Reconcile to existing earning documents</option>
                <option value="REJECT">Reject unsupported request</option>
              </select>
            </label>
            {reconciliationDecision === "RECONCILE" && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-slate-700">Verified open earning documents</legend>
                {(reconciliationRequest.reconciliationCandidates || []).length === 0 ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No eligible existing earning documents were found. Do not invent a backfill; investigate the source records first.</p>
                ) : (reconciliationRequest.reconciliationCandidates || []).map((document) => (
                  <label key={document.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedEarningDocumentIds.includes(document.id)}
                      onChange={(event) => setSelectedEarningDocumentIds((current) => event.target.checked
                        ? [...current, document.id]
                        : current.filter((id) => id !== document.id))}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-slate-900">{document.documentNumber}</span>
                      <span className="text-xs text-slate-500">{document.sourceType} · source {document.sourceId}</span>
                      <span className="mt-1 block text-xs font-semibold text-emerald-700">Open Rs {Number(document.remainingAmount || 0).toFixed(2)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="block text-sm font-semibold text-slate-700">
              Review notes (required)
              <textarea
                required
                maxLength={1000}
                rows={3}
                value={reconciliationNotes}
                onChange={(event) => setReconciliationNotes(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setReconciliationRequest(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button
                type="submit"
                disabled={savingReconciliation || (reconciliationDecision === "RECONCILE" && selectedEarningDocumentIds.length === 0)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${reconciliationDecision === "REJECT" ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-900 hover:bg-black"}`}
              >
                {savingReconciliation ? "Saving..." : reconciliationDecision === "REJECT" ? "Reject request" : "Link verified earnings"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};

export default DistributorApplications;
