import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Check, ExternalLink, LoaderCircle, MapPin, RefreshCw, Truck } from "lucide-react";
import { toast } from "react-toastify";
import { backendUrl, currency, useManufacturer } from "../context/ManufacturerContext";
import SignatureCapture from "../components/SignatureCapture";
import { validatePodForm } from "../utils/distributorLogisticsValidation";

const api = `${backendUrl}/api/distributor`;
const initialForm = {
  outcome: "DELIVERED",
  recipientName: "",
  notes: "",
  partialQuantity: "",
  failedReason: "",
  photo: null,
  signatureData: "",
  otpCode: "",
  otpRequired: true,
  collectionConfirmed: false,
  paymentMethod: "CASH",
};

const prettyStatus = (value) => String(value || "PENDING").replaceAll("_", " ");
const addressText = (address = {}) => [
  address.street,
  address.neighborhood,
  address.city,
  address.district,
  address.province,
].filter(Boolean).join(", ");
const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
const routeFallbackMessage = (reason) => ({
  PROVIDER_NOT_CONFIGURED: "No road-routing provider is configured. The existing deterministic order is proposed.",
  NO_VALID_COORDINATES: "No stops have valid coordinates for road routing. The existing deterministic order is proposed.",
  PROVIDER_TIMEOUT: "The road-routing provider timed out. The existing deterministic order is proposed.",
  PROVIDER_RATE_LIMITED: "The road-routing provider is rate limiting requests. The existing deterministic order is proposed.",
  PROVIDER_SERVER_ERROR: "The road-routing provider is unavailable. The existing deterministic order is proposed.",
  PROVIDER_ERROR: "The road-routing request failed. The existing deterministic order is proposed.",
  INVALID_PROVIDER_RESPONSE: "The road-routing provider returned an invalid response. The existing deterministic order is proposed.",
}[reason] || "Road routing is unavailable. The existing deterministic order is proposed.");

const DistributorLogistics = () => {
  const { token } = useManufacturer();
  const [manifests, setManifests] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedManifestId, setSelectedManifestId] = useState("");
  const [selectedStopId, setSelectedStopId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [manifestAction, setManifestAction] = useState("");
  const [routeProposal, setRouteProposal] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState(null);
  const retrySubmission = useRef(null);
  const loadRequestId = useRef(0);
  const routeProposalRequestId = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    routeProposalRequestId.current += 1;
    setRouteProposal(null);
    setManifestAction((current) => current === "previewRoute" ? "" : current);
    if (!token) return;
    setLoading(true);
    setPageError("");
    try {
      const [manifestResponse, driverResponse] = await Promise.all([
        axios.get(`${api}/logistics/manifests`, { headers: { token }, params: { limit: 100 } }),
        axios.get(`${api}/logistics/drivers`, { headers: { token } }),
      ]);
      if (requestId !== loadRequestId.current) return;
      const nextManifests = manifestResponse.data.manifests || [];
      setManifests(nextManifests);
      setDrivers(driverResponse.data.drivers || []);
      setSelectedManifestId((current) =>
        nextManifests.some((manifest) => manifest.id === current)
          ? current
          : nextManifests[0]?.id || "",
      );
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      const message = error.response?.data?.message || "Could not load delivery manifests.";
      setPageError(error.response?.status === 403
        ? "Your account does not have permission to manage delivery manifests."
        : message);
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
    return () => {
      loadRequestId.current += 1;
      routeProposalRequestId.current += 1;
    };
  }, [loadData]);
  useEffect(() => () => {
    if (evidencePreview?.url) URL.revokeObjectURL(evidencePreview.url);
  }, [evidencePreview]);

  const selectedManifest = manifests.find((manifest) => manifest.id === selectedManifestId) || null;
  const selectedStop = selectedManifest?.stops?.find((stop) => stop.id === selectedStopId) || null;
  const isUnpaidCod = String(selectedStop?.order?.paymentMethod || "").toUpperCase() === "COD" &&
    selectedStop?.order?.payment === false;

  useEffect(() => {
    if (!selectedManifest?.stops?.some((stop) => stop.id === selectedStopId)) {
      setSelectedStopId(selectedManifest?.stops?.find((stop) => !stop.proof)?.id || "");
    }
  }, [selectedManifest, selectedStopId]);

  useEffect(() => {
    setForm({
      ...initialForm,
      recipientName: selectedStop?.recipientNameSnapshot || "",
    });
    retrySubmission.current = null;
  }, [selectedStopId, selectedStop?.recipientNameSnapshot]);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const requestOtp = async () => {
    if (!selectedStop?.orderId) return;
    setRequestingOtp(true);
    try {
      const response = await axios.post(
        `${api}/orders/${encodeURIComponent(selectedStop.orderId)}/delivery-otp`,
        {},
        { headers: { token } },
      );
      updateForm("otpRequired", response.data.otpRequired !== false);
      toast.success(response.data.message || "Customer delivery verification requested.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not request the customer delivery code.");
    } finally {
      setRequestingOtp(false);
    }
  };

  const submitProof = async (event) => {
    event.preventDefault();
    if (!selectedManifest || !selectedStop || submitting) return;
    const validationMessage = validatePodForm({
      ...form,
      parcelCount: selectedStop.parcelCount,
      hasPhoto: Boolean(form.photo),
      hasSignature: Boolean(form.signatureData),
      isUnpaidCod,
    });
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    if (!window.confirm(`Record ${prettyStatus(form.outcome).toLowerCase()} for ${selectedManifest.manifestCode}, stop ${selectedStop.stopSequence}?`)) return;

    const fingerprint = JSON.stringify({
      outcome: form.outcome,
      recipientName: form.recipientName.trim(),
      notes: form.notes,
      partialQuantity: form.partialQuantity,
      failedReason: form.failedReason,
      otpCode: form.otpCode,
      otpRequired: form.otpRequired,
      collectionConfirmed: form.collectionConfirmed,
      paymentMethod: form.paymentMethod,
      photo: form.photo ? [form.photo.name, form.photo.size, form.photo.lastModified] : null,
      signatureData: form.signatureData,
    });
    const idempotencyKey = retrySubmission.current?.fingerprint === fingerprint
      ? retrySubmission.current.key
      : crypto.randomUUID();
    retrySubmission.current = { fingerprint, key: idempotencyKey };

    const body = new FormData();
    body.append("outcome", form.outcome);
    body.append("recipientName", form.recipientName.trim());
    body.append("notes", form.notes.trim());
    body.append("idempotencyKey", idempotencyKey);
    if (form.outcome === "PARTIAL") body.append("partialQuantity", form.partialQuantity);
    if (form.outcome === "FAILED") body.append("failedReason", form.failedReason.trim());
    if (form.signatureData) body.append("signatureData", form.signatureData);
    if (form.photo) body.append("photo", form.photo);
    if (isUnpaidCod) {
      body.append("paymentMethod", form.paymentMethod);
      if (form.otpRequired) body.append("otpCode", form.otpCode.trim());
      else body.append("collectionConfirmed", String(form.collectionConfirmed));
    }

    setSubmitting(true);
    try {
      await axios.post(
        `${api}/logistics/manifests/${encodeURIComponent(selectedManifest.id)}/stops/${encodeURIComponent(selectedStop.id)}/complete`,
        body,
        { headers: { token } },
      );
      retrySubmission.current = null;
      toast.success("Delivery proof recorded.");
      setSelectedStopId("");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Delivery proof was not recorded. Review the form and retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const manifestOperation = async (kind) => {
    if (!selectedManifest || manifestAction) return;
    const actionText = kind === "dispatch" ? "dispatch this route" : "assign the selected driver";
    if (!window.confirm(`Are you sure you want to ${actionText}?`)) return;
    setManifestAction(kind);
    try {
      if (kind === "assign") {
        await axios.post(
          `${api}/logistics/manifests/${encodeURIComponent(selectedManifest.id)}/assign`,
          { driverId: selectedDriverId || selectedManifest.driverId },
          { headers: { token } },
        );
      } else {
        await axios.post(
          `${api}/logistics/manifests/${encodeURIComponent(selectedManifest.id)}/dispatch`,
          {},
          { headers: { token } },
        );
      }
      toast.success(kind === "dispatch" ? "Manifest dispatched." : "Driver assigned.");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || `Could not ${actionText}.`);
    } finally {
      setManifestAction("");
    }
  };

  const requestRouteProposal = async () => {
    if (!selectedManifest || manifestAction) return;
    const manifestId = selectedManifest.id;
    const requestId = ++routeProposalRequestId.current;
    setRouteProposal(null);
    setManifestAction("previewRoute");
    try {
      const response = await axios.post(
        `${api}/logistics/manifests/${encodeURIComponent(manifestId)}/optimize`,
        {},
        { headers: { token } },
      );
      if (requestId !== routeProposalRequestId.current) return;
      const proposal = response.data.proposal;
      if (proposal?.manifestId !== manifestId ||
          proposal.provenance !== "DETERMINISTIC_FALLBACK" ||
          !Array.isArray(proposal.currentStopIds) ||
          !Array.isArray(proposal.orderedStopIds)) {
        toast.error("The server returned an invalid route proposal. The manifest order was not changed.");
        return;
      }
      setRouteProposal(proposal);
    } catch (error) {
      if (requestId === routeProposalRequestId.current) {
        toast.error(error.response?.data?.message || "Could not prepare a route-order proposal.");
      }
    } finally {
      if (requestId === routeProposalRequestId.current) setManifestAction("");
    }
  };

  const applyRouteProposal = async () => {
    if (!selectedManifest || !routeProposal || routeProposal.manifestId !== selectedManifest.id ||
        routeProposal.provenance !== "DETERMINISTIC_FALLBACK" || manifestAction) return;
    if (!window.confirm("Apply this reviewed stop order? The current manifest order will change.")) return;
    setManifestAction("applyRoute");
    try {
      await axios.patch(
        `${api}/logistics/manifests/${encodeURIComponent(selectedManifest.id)}/optimize`,
        {
          expectedStopIds: routeProposal.currentStopIds,
          orderedStopIds: routeProposal.orderedStopIds,
        },
        { headers: { token } },
      );
      setRouteProposal(null);
      toast.success("The reviewed stop order was applied.");
      await loadData();
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not apply the route-order proposal. Refresh and review the current order.");
    } finally {
      setManifestAction("");
    }
  };

  const viewEvidence = async (stop, kind) => {
    try {
      const response = await axios.get(
        `${api}/logistics/manifests/${encodeURIComponent(selectedManifest.id)}/stops/${encodeURIComponent(stop.id)}/evidence/${kind}`,
        { headers: { token }, responseType: "blob" },
      );
      setEvidencePreview({ url: URL.createObjectURL(response.data), kind });
    } catch (error) {
      toast.error(error.response?.data?.message || "Could not retrieve authenticated delivery evidence.");
    }
  };

  const assignedDrivers = useMemo(() => drivers.filter((driver) => driver.status === "ACTIVE"), [drivers]);

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600" role="status"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading manifests…</div>;
  }

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[#dedbd3] pb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Distributor logistics</p>
          <h1 className="mt-1 text-2xl font-black text-[#171717]">Delivery manifests &amp; proof of delivery</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">View assigned routes, complete delivery stops through the existing COD-validated workflow, and retrieve private evidence through authenticated access.</p>
        </div>
        <button type="button" onClick={loadData} disabled={loading || Boolean(manifestAction)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {pageError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <span>{pageError}</span>
          <button type="button" onClick={loadData} className="font-bold underline">Retry</button>
        </div>
      )}

      {!pageError && manifests.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Truck className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 font-bold text-slate-900">No delivery manifests yet</h2>
          <p className="mt-1 text-sm text-slate-600">Create a route from Self-Delivery Orders, then assign a driver and record each stop here.</p>
        </div>
      )}

      {manifests.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.5fr)]">
          <aside className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Manifests ({manifests.length})</h2>
            <div className="max-h-[70vh] space-y-2 overflow-auto">
              {manifests.map((manifest) => (
                <button
                  type="button"
                  key={manifest.id}
                  onClick={() => {
                    routeProposalRequestId.current += 1;
                    setSelectedManifestId(manifest.id);
                    setSelectedStopId("");
                    setRouteProposal(null);
                    setManifestAction((current) => current === "previewRoute" ? "" : current);
                  }}
                  aria-pressed={manifest.id === selectedManifestId}
                  className={`w-full rounded-xl border p-3 text-left ${manifest.id === selectedManifestId ? "border-emerald-700 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">{manifest.manifestCode}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold">{prettyStatus(manifest.status)}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">{manifest.stops?.length || 0} stops · {manifest.driver?.name || "Unassigned"}</span>
                </button>
              ))}
            </div>
          </aside>

          {selectedManifest && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <h2 className="text-lg font-black text-slate-950">{selectedManifest.name || selectedManifest.manifestCode}</h2>
                  <p className="mt-1 text-xs text-slate-600">{selectedManifest.manifestCode} · {prettyStatus(selectedManifest.status)} · {selectedManifest.driver?.name || "No driver assigned"}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Dispatched {formatDate(selectedManifest.dispatchedAt)} · completed {formatDate(selectedManifest.completedAt)}</p>
                  {selectedManifest.optimizationSnapshot?.lastAppliedOrdering && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Current order: {selectedManifest.optimizationSnapshot.lastAppliedOrdering.source === "MANUAL" ? "manually arranged" : "deterministic fallback"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  {["PREPARING", "ASSIGNED"].includes(selectedManifest.status) && (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(manifestAction)}
                        onClick={requestRouteProposal}
                        className="min-h-10 rounded-lg border border-emerald-800 px-3 text-xs font-bold text-emerald-900 disabled:opacity-50"
                      >
                        {manifestAction === "previewRoute" ? "Preparing proposal…" : "Preview route order"}
                      </button>
                      <label className="text-xs font-semibold text-slate-700">
                        Active driver
                        <select value={selectedDriverId || selectedManifest.driverId || ""} onChange={(event) => setSelectedDriverId(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                          <option value="">Select driver</option>
                          {assignedDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                        </select>
                      </label>
                      <button type="button" disabled={!selectedDriverId && !selectedManifest.driverId || Boolean(manifestAction)} onClick={() => manifestOperation("assign")} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold disabled:opacity-50">
                        {manifestAction === "assign" ? "Assigning…" : "Assign driver"}
                      </button>
                    </>
                  )}
                  {selectedManifest.status === "ASSIGNED" && (
                    <button type="button" disabled={Boolean(manifestAction)} onClick={() => manifestOperation("dispatch")} className="min-h-10 rounded-lg bg-emerald-800 px-3 text-xs font-bold text-white disabled:opacity-50">
                      {manifestAction === "dispatch" ? "Dispatching…" : "Dispatch route"}
                    </button>
                  )}
                </div>
              </div>

              {routeProposal && (
                <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4" aria-label="Route order proposal">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-sky-950">Review deterministic suggested order</h3>
                      <p className="mt-1 text-xs text-sky-900">
                        This uses the existing priority, time-window, district, and city ordering. It is not road-distance optimized and includes no travel-time or traffic estimate. Your current manifest order remains unchanged unless you apply this proposal.
                      </p>
                      <p className="mt-1 text-xs text-sky-900">{routeFallbackMessage(routeProposal.fallbackReason)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setRouteProposal(null)} disabled={Boolean(manifestAction)} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold disabled:opacity-50">
                        Keep current order
                      </button>
                      <button type="button" onClick={applyRouteProposal} disabled={Boolean(manifestAction)} className="min-h-9 rounded-lg bg-emerald-800 px-3 text-xs font-bold text-white disabled:opacity-50">
                        {manifestAction === "applyRoute" ? "Applying…" : "Apply this order"}
                      </button>
                    </div>
                  </div>
                  {routeProposal.unroutableStops?.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      <p className="font-bold">Stops without routable coordinates or a route result</p>
                      <p className="mt-1">These stops remain in the deterministic proposal order.</p>
                      <ul className="mt-1 list-inside list-disc">
                        {routeProposal.unroutableStops.map(({ stopId, reason }) => {
                          const stop = selectedManifest.stops?.find((item) => item.id === stopId);
                          return <li key={stopId}>Stop {stop?.stopSequence || "?"}: {String(reason).replaceAll("_", " ").toLowerCase()}</li>;
                        })}
                      </ul>
                    </div>
                  )}
                  <ol className="grid gap-2 sm:grid-cols-2">
                    {routeProposal.orderedStopIds.map((stopId, index) => {
                      const stop = selectedManifest.stops?.find((item) => item.id === stopId);
                      return (
                        <li key={stopId} className="rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs">
                          <span className="font-bold text-sky-950">{index + 1}. </span>
                          {stop?.order?.orderReference || stop?.orderId || "Manifest stop"}
                          {stop && <span className="block text-slate-600">{addressText(stop.addressSnapshot) || "Delivery address unavailable"}</span>}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(300px,1.1fr)]">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900">Stops</h3>
                  {(selectedManifest.stops || []).map((stop) => (
                    <button type="button" key={stop.id} onClick={() => setSelectedStopId(stop.id)} aria-pressed={stop.id === selectedStopId} className={`w-full rounded-xl border p-3 text-left ${stop.id === selectedStopId ? "border-emerald-700 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">Stop {stop.stopSequence} · {stop.order?.orderReference || stop.orderId.slice(0, 8)}</span>
                        <span className="text-[10px] font-semibold text-slate-600">{prettyStatus(stop.status)}</span>
                      </span>
                      <span className="mt-1 block text-xs text-slate-700">{stop.recipientNameSnapshot || "Recipient not specified"}</span>
                      <span className="mt-1 block text-[11px] text-slate-500">{addressText(stop.addressSnapshot) || "Delivery address unavailable"}</span>
                      {stop.completedAt && <span className="mt-1 block text-[10px] text-slate-500">Completed {formatDate(stop.completedAt)}</span>}
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  {!selectedStop ? (
                    <div className="flex min-h-40 flex-col items-center justify-center text-center text-sm text-slate-500">
                      <MapPin className="mb-2 h-6 w-6" /> Select a stop to view delivery details.
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-slate-100 pb-3">
                        <h3 className="font-bold text-slate-950">Stop {selectedStop.stopSequence} · {selectedStop.order?.orderReference || selectedStop.orderId}</h3>
                        <p className="mt-1 text-xs text-slate-600">{addressText(selectedStop.addressSnapshot) || "Delivery address unavailable"}</p>
                        <p className="mt-1 text-xs text-slate-600">{selectedStop.parcelCount} parcel(s) · {prettyStatus(selectedStop.status)}</p>
                        {selectedStop.order && (
                          <p className="mt-1 text-xs font-semibold text-slate-700">
                            {isUnpaidCod ? "COD due" : `Payment: ${selectedStop.order.payment ? "paid" : "unpaid"}`}
                            {" · "}{currency}{Number(selectedStop.order.amount || 0).toLocaleString()}
                            {Number(selectedStop.order.deliveryFee || 0) > 0 && ` + delivery ${currency}${Number(selectedStop.order.deliveryFee).toLocaleString()}`}
                          </p>
                        )}
                      </div>

                      {selectedStop.proof ? (
                        <div className="space-y-3 pt-3">
                          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
                            <p className="font-bold"><Check className="mr-1 inline h-4 w-4" /> {prettyStatus(selectedStop.proof.outcome)} recorded</p>
                            <p className="mt-1 text-xs">Recipient: {selectedStop.proof.recipientName} · {formatDate(selectedStop.proof.verifiedAt)}</p>
                            {selectedStop.proof.notes && <p className="mt-2 text-xs">{selectedStop.proof.notes}</p>}
                            {selectedStop.proof.failedReason && <p className="mt-1 text-xs">Reason: {selectedStop.proof.failedReason}</p>}
                            {selectedStop.proof.partialQuantity && <p className="mt-1 text-xs">Partial parcels: {selectedStop.proof.partialQuantity} of {selectedStop.parcelCount}</p>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedStop.proof.photoPath && <button type="button" onClick={() => viewEvidence(selectedStop, "photo")} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"><ExternalLink className="h-3 w-3" /> View delivery photo</button>}
                            {selectedStop.proof.signaturePath && <button type="button" onClick={() => viewEvidence(selectedStop, "signature")} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"><ExternalLink className="h-3 w-3" /> View signature</button>}
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={submitProof} className="space-y-3 pt-3">
                          {selectedManifest.status !== "IN_TRANSIT" && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Dispatch the manifest before recording a delivery outcome.</p>
                          )}
                          <label className="block text-xs font-semibold text-slate-800">
                            Delivery outcome
                            <select value={form.outcome} onChange={(event) => updateForm("outcome", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                              <option value="DELIVERED">Delivered</option>
                              <option value="PARTIAL">Partially delivered</option>
                              <option value="FAILED">Failed delivery</option>
                            </select>
                          </label>
                          <label className="block text-xs font-semibold text-slate-800">
                            Recipient name
                            <input required maxLength={191} value={form.recipientName} onChange={(event) => updateForm("recipientName", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
                          </label>
                          {form.outcome === "PARTIAL" && (
                            <label className="block text-xs font-semibold text-slate-800">
                              Parcels delivered (of {selectedStop.parcelCount})
                              <input required type="number" min="1" max={Math.max(1, Number(selectedStop.parcelCount || 1) - 1)} step="1" value={form.partialQuantity} onChange={(event) => updateForm("partialQuantity", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
                            </label>
                          )}
                          {form.outcome === "FAILED" && (
                            <label className="block text-xs font-semibold text-slate-800">
                              Failure reason
                              <input required maxLength={191} value={form.failedReason} onChange={(event) => updateForm("failedReason", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
                            </label>
                          )}
                          {form.outcome === "DELIVERED" && (
                            <div>
                              <label className="block text-xs font-semibold text-slate-800">
                                Delivery photo (JPG/PNG, max 8 MB)
                                <input type="file" accept="image/jpeg,image/png" onChange={(event) => updateForm("photo", event.target.files?.[0] || null)} className="mt-1 block w-full text-xs" />
                              </label>
                              <div className="mt-3">
                                <SignatureCapture key={selectedStop.id} value={form.signatureData} onChange={(value) => updateForm("signatureData", value)} />
                              </div>
                            </div>
                          )}
                          {isUnpaidCod && form.outcome === "DELIVERED" && (
                            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <p className="text-xs font-bold text-amber-950">Cash on delivery: collect {currency}{(Number(selectedStop.order.amount || 0) + Number(selectedStop.order.deliveryFee || 0)).toLocaleString()} before confirming handoff.</p>
                              <button type="button" disabled={requestingOtp || selectedManifest.status !== "IN_TRANSIT"} onClick={requestOtp} className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-950 disabled:opacity-50">
                                {requestingOtp ? "Requesting…" : "Request customer verification code"}
                              </button>
                              {form.otpRequired ? (
                                <label className="block text-xs font-semibold text-amber-950">
                                  Customer code
                                  <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.otpCode} onChange={(event) => updateForm("otpCode", event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 min-h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm" />
                                </label>
                              ) : (
                                <label className="flex items-start gap-2 text-xs leading-5 text-amber-950">
                                  <input type="checkbox" checked={form.collectionConfirmed} onChange={(event) => updateForm("collectionConfirmed", event.target.checked)} className="mt-1" />
                                  I confirm the full COD amount was collected from the recipient.
                                </label>
                              )}
                              <label className="block text-xs font-semibold text-amber-950">
                                Payment method
                                <select value={form.paymentMethod} onChange={(event) => updateForm("paymentMethod", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm">
                                  <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CARD">Card</option>
                                </select>
                              </label>
                            </div>
                          )}
                          <label className="block text-xs font-semibold text-slate-800">
                            Delivery notes
                            <textarea maxLength={4000} value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                          </label>
                          <button type="submit" disabled={submitting || selectedManifest.status !== "IN_TRANSIT"} className="min-h-11 w-full rounded-lg bg-emerald-800 px-4 text-sm font-bold text-white disabled:opacity-50">
                            {submitting ? "Recording proof…" : "Record delivery outcome"}
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {evidencePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Private delivery evidence">
          <div className="max-h-[90vh] w-full max-w-3xl rounded-xl bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Authenticated {evidencePreview.kind}</h2>
              <button type="button" onClick={() => setEvidencePreview(null)} className="rounded px-3 py-2 text-sm font-bold">Close</button>
            </div>
            <img src={evidencePreview.url} alt={`Delivery ${evidencePreview.kind}`} className="mx-auto max-h-[75vh] max-w-full object-contain" />
          </div>
        </div>
      )}
    </section>
  );
};

export default DistributorLogistics;
