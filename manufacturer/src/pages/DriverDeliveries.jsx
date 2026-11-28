import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Phone,
  RefreshCw,
  Truck,
  WifiOff,
} from "lucide-react";
import { backendUrl, currency, useManufacturer } from "../context/ManufacturerContext";
import SignatureCapture from "../components/SignatureCapture";
import {
  blobToDataUrl,
  cleanupConfirmedDriverDrafts,
  clearDriverOfflineData,
  clearAssignedManifestSnapshots,
  createDriverOfflineScope,
  deleteDriverDraft,
  draftFormForEditing,
  getCachedAssignedManifests,
  getDriverDraft,
  getDriverDrafts,
  getOfflineSyncMetadata,
  saveAssignedManifestSnapshots,
  saveDriverDraft,
  setOfflineSyncMetadata,
} from "../offline/driverOfflineStore";
import {
  buildDriverMapUrl,
  buildPodCompletionPayload,
  buildPodSubmissionFingerprint,
  getDriverManifestProgress,
  getPodIdempotencyKey,
  isPodSubmissionOutcomeUncertain,
  validatePodForm,
} from "../utils/distributorLogisticsValidation";

const api = `${backendUrl}/api/driver`;
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

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};
const prettyStatus = (value) => String(value || "PENDING").replaceAll("_", " ");
const getStopDraftKey = (manifestId, stopId) => (
  manifestId && stopId ? `${manifestId}:${stopId}` : ""
);
const addressText = (address) => {
  if (typeof address === "string") return address.trim();
  if (!address || typeof address !== "object") return "";
  return [
    address.street,
    address.address,
    address.neighborhood,
    address.city,
    address.district,
    address.province,
  ].filter(Boolean).join(", ");
};
const stopPhone = (address) => address?.phone || address?.phoneNumber || address?.contactPhone || "";

const DriverDeliveries = () => {
  const { token, driver } = useManufacturer();
  const offlineScope = useMemo(() => createDriverOfflineScope(token, driver), [token, driver]);
  const [manifests, setManifests] = useState([]);
  const [driverDrafts, setDriverDrafts] = useState([]);
  const [selectedManifestId, setSelectedManifestId] = useState("");
  const [selectedStopId, setSelectedStopId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [connectionState, setConnectionState] = useState(() => navigator.onLine ? "checking" : "offline");
  const [storageWarning, setStorageWarning] = useState("");
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState("");
  const [evidencePreview, setEvidencePreview] = useState(null);
  const retrySubmission = useRef(null);
  const manifestsRef = useRef(manifests);
  const selectedManifestIdRef = useRef(selectedManifestId);
  const selectedStopIdRef = useRef(selectedStopId);
  const formRef = useRef(form);
  const formDrafts = useRef(new Map());
  const currentDraftKey = useRef("");
  const submitLock = useRef(false);
  const otpRequestLock = useRef(false);
  const syncLock = useRef(false);
  const draftPersistQueue = useRef(Promise.resolve());

  const activateStop = useCallback((manifestId, stopId, stop) => {
    const previousDraftKey = currentDraftKey.current;
    if (previousDraftKey) {
      formDrafts.current.set(previousDraftKey, { ...formRef.current, otpCode: "" });
    }
    const nextDraftKey = getStopDraftKey(manifestId, stopId);
    const changedStop = previousDraftKey !== nextDraftKey;
    currentDraftKey.current = nextDraftKey;
    selectedManifestIdRef.current = manifestId || "";
    selectedStopIdRef.current = stopId || "";
    setSelectedManifestId(manifestId || "");
    setSelectedStopId(stopId || "");
    const savedDraft = nextDraftKey && !stop?.proof ? formDrafts.current.get(nextDraftKey) : null;
    const nextForm = savedDraft
      ? { ...initialForm, ...savedDraft, recipientName: savedDraft.recipientName || stop?.recipientName || "" }
      : { ...initialForm, recipientName: stop?.recipientName || "" };
    if (changedStop) nextForm.otpCode = "";
    formRef.current = nextForm;
    setForm(nextForm);
    if (changedStop) {
      setActionError("");
      setActionNotice("");
      retrySubmission.current = null;
    }
  }, []);

  const replaceDraft = useCallback((draft) => {
    setDriverDrafts((current) => {
      const next = current.filter((item) => (
        item.manifestId !== draft.manifestId || item.stopId !== draft.stopId
      ));
      return [...next, draft].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    });
  }, []);

  const persistDraft = useCallback((input) => {
    if (!offlineScope) {
      return Promise.reject(new Error("Driver account scope is unavailable; this draft cannot be saved locally."));
    }
    const task = draftPersistQueue.current
      .catch(() => {})
      .then(() => saveDriverDraft(offlineScope, input));
    draftPersistQueue.current = task;
    return task.then((draft) => {
      replaceDraft(draft);
      setStorageWarning("");
      return draft;
    }, (error) => {
      setStorageWarning(error.message || "Offline storage failed. Local changes may not survive closing this page.");
      throw error;
    });
  }, [offlineScope, replaceDraft]);

  const restoreDraftForms = useCallback(async (drafts) => {
    for (const draft of drafts) {
      if (!["DRAFT", "REQUIRES_ONLINE_COD"].includes(draft.status)) continue;
      formDrafts.current.set(
        getStopDraftKey(draft.manifestId, draft.stopId),
        await draftFormForEditing(draft),
      );
    }
  }, []);

  const recoverInterruptedDrafts = useCallback(async (drafts) => {
    if (submitLock.current || syncLock.current) return drafts;
    const recovered = [];
    for (const draft of drafts) {
      if (draft.status === "SYNCING") {
        recovered.push(await persistDraft({
          ...draft,
          status: "AWAITING_RECONCILIATION",
          formSnapshot: draft.formSnapshot,
          photoBlob: draft.photoBlob,
          signatureBlob: draft.signatureBlob,
          conflictCode: "",
          conflictMessage: "The page closed during synchronization. Refresh authoritative state before retrying.",
        }));
      } else {
        recovered.push(draft);
      }
    }
    return recovered;
  }, [persistDraft]);

  const loadData = useCallback(async () => {
    if (!token) {
      setManifests([]);
      setDriverDrafts([]);
      selectedManifestIdRef.current = "";
      selectedStopIdRef.current = "";
      currentDraftKey.current = "";
      formDrafts.current.clear();
      retrySubmission.current = null;
      setSelectedManifestId("");
      setSelectedStopId("");
      formRef.current = initialForm;
      setForm(initialForm);
      setNeedsRefresh(false);
      setConnectionState(navigator.onLine ? "checking" : "offline");
      setPageError("Your driver session is unavailable. Sign in again to view assigned deliveries.");
      setLoading(false);
      return false;
    }
    setLoading(true);
    setPageError("");
    let cachedManifests = [];
    try {
      if (offlineScope) {
        await draftPersistQueue.current.catch(() => {});
        await cleanupConfirmedDriverDrafts(offlineScope);
        const [cached, storedDrafts, metadata] = await Promise.all([
          getCachedAssignedManifests(offlineScope),
          getDriverDrafts(offlineScope),
          getOfflineSyncMetadata(offlineScope),
        ]);
        const drafts = await recoverInterruptedDrafts(storedDrafts);
        cachedManifests = cached;
        setManifests(cached);
        setDriverDrafts(drafts);
        setLastSyncAt(metadata?.lastSyncAt || "");
        await restoreDraftForms(drafts);
        const cachedManifest = cached.find((manifest) => manifest.id === selectedManifestIdRef.current) ||
          cached.find((manifest) => manifest.status === "IN_TRANSIT") ||
          cached[0];
        const cachedStop = cachedManifest?.stops?.find((stop) => stop.id === selectedStopIdRef.current) ||
          cachedManifest?.stops?.find((stop) => !stop.proof && !["DELIVERED", "FAILED", "PARTIAL"].includes(stop.status)) ||
          cachedManifest?.stops?.[0];
        activateStop(cachedManifest?.id || "", cachedStop?.id || "", cachedStop);
      } else {
        setStorageWarning("This driver session cannot be scoped for persistent offline storage. Online delivery may continue, but offline work cannot be saved.");
      }
    } catch (error) {
      setStorageWarning(error.message || "Persistent offline storage is unavailable.");
    }
    if (!navigator.onLine) {
      setIsOnline(false);
      setConnectionState("offline");
      if (!cachedManifests.length) {
        setPageError("You are offline and no assigned manifest is saved on this device. Reconnect and refresh before starting delivery work.");
      } else {
        setActionNotice("Showing the last saved assigned manifest. Refresh server state before synchronizing any uncertain delivery.");
      }
      setLoading(false);
      return false;
    }
    setIsOnline(true);
    setConnectionState("checking");
    try {
      const response = await axios.get(`${api}/manifests`, { headers: { token } });
      const nextManifests = response.data.manifests || [];
      setManifests(nextManifests);
      setConnectionState("online");
      setActionNotice("");
      if (offlineScope) {
        try {
          await saveAssignedManifestSnapshots(offlineScope, nextManifests);
          const storedDrafts = await getDriverDrafts(offlineScope);
          const drafts = await recoverInterruptedDrafts(storedDrafts);
          setDriverDrafts(drafts);
          await restoreDraftForms(drafts);
          const metadata = await getOfflineSyncMetadata(offlineScope);
          setLastSyncAt(metadata?.lastSyncAt || "");
        } catch (storageError) {
          setStorageWarning(storageError.message || "Server data refreshed, but local storage could not be updated.");
        }
      }
      const selected = nextManifests.find((manifest) => manifest.id === selectedManifestIdRef.current);
      const preferredManifest = selected || nextManifests.find((manifest) => manifest.status === "IN_TRANSIT") ||
        nextManifests.find((manifest) => manifest.status === "ASSIGNED") || nextManifests[0];
      const currentStop = preferredManifest?.stops?.find((stop) => stop.id === selectedStopIdRef.current);
      const nextStop = currentStop || preferredManifest?.stops?.find((stop) => (
        !stop.proof && !["DELIVERED", "FAILED", "PARTIAL"].includes(stop.status)
      )) || preferredManifest?.stops?.[0];
      activateStop(preferredManifest?.id || "", nextStop?.id || "", nextStop);
      setNeedsRefresh(false);
      return true;
    } catch (error) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        setConnectionState("restricted");
        setManifests([]);
        selectedManifestIdRef.current = "";
        selectedStopIdRef.current = "";
        currentDraftKey.current = "";
        formDrafts.current.clear();
        retrySubmission.current = null;
        setSelectedManifestId("");
        setSelectedStopId("");
        formRef.current = initialForm;
        setForm(initialForm);
        setNeedsRefresh(false);
        setPageError(status === 403
          ? "Your driver account is not authorized to view assigned deliveries."
          : "Your driver session has expired. Sign in again to view assigned deliveries.");
        if (offlineScope) {
          try {
            await clearAssignedManifestSnapshots(offlineScope);
            setDriverDrafts(await getDriverDrafts(offlineScope));
          } catch (storageError) {
            setStorageWarning(storageError.message || "Driver access could not be checked against local storage.");
          }
        }
      } else {
        setConnectionState(error.response ? "unavailable" : "offline");
        if (!error.response) setIsOnline(false);
        if (manifestsRef.current.length || cachedManifests.length) {
          setPageError("");
          setActionNotice("The server could not be reached. Showing saved assignments only; queued actions require an authoritative refresh before sync.");
        } else {
          setPageError(error.response?.data?.message || "Could not load assigned delivery manifests, and no saved assignments are available.");
        }
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [activateStop, offlineScope, recoverInterruptedDrafts, restoreDraftForms, token]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { manifestsRef.current = manifests; }, [manifests]);
  useEffect(() => {
    const online = () => {
      setIsOnline(true);
      setConnectionState("checking");
      loadData();
    };
    const offline = () => {
      setIsOnline(false);
      setConnectionState("offline");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [loadData]);
  useEffect(() => () => {
    if (evidencePreview?.url) URL.revokeObjectURL(evidencePreview.url);
  }, [evidencePreview]);

  const selectedManifest = manifests.find((manifest) => manifest.id === selectedManifestId) || null;
  const selectedStop = selectedManifest?.stops?.find((stop) => stop.id === selectedStopId) || null;
  const activeDraft = driverDrafts.find((draft) => (
    draft.manifestId === selectedManifestId && draft.stopId === selectedStopId
  )) || null;
  const isUnpaidCod = Boolean(selectedStop?.order?.codPaymentRequired);
  const progress = getDriverManifestProgress(selectedManifest);
  const nextStop = selectedManifest?.stops?.find((stop) => !stop.proof && !["DELIVERED", "FAILED", "PARTIAL"].includes(stop.status));

  const updateForm = (key, value) => {
    const next = { ...formRef.current, [key]: value };
    formRef.current = next;
    setForm(next);
    const draftKey = currentDraftKey.current;
    if (draftKey) formDrafts.current.set(draftKey, next);
    if (key === "otpCode" || !offlineScope || !selectedManifest || !selectedStop) return;
    const status = activeDraft?.status || "DRAFT";
    if (!["DRAFT", "REQUIRES_ONLINE_COD"].includes(status)) return;
    void persistDraft({
      manifestId: selectedManifest.id,
      stopId: selectedStop.id,
      form: next,
      status,
      codPaymentRequired: isUnpaidCod,
      parcelCount: selectedStop.parcelCount,
      idempotencyKey: activeDraft?.idempotencyKey,
      offlineCollectionClaim: activeDraft?.formSnapshot?.codCollectionClaim,
    }).catch(() => {});
  };

  const selectManifest = (manifestId) => {
    const manifest = manifests.find((item) => item.id === manifestId);
    const next = manifest?.stops?.find((stop) => !stop.proof && !["DELIVERED", "FAILED", "PARTIAL"].includes(stop.status));
    const stop = next || manifest?.stops?.[0];
    activateStop(manifest?.id || "", stop?.id || "", stop);
  };

  const selectStop = (stop) => activateStop(selectedManifestId, stop?.id || "", stop);

  const requestOtp = async () => {
    if (!selectedStop || requestingOtp || otpRequestLock.current || !isOnline || pageError) return;
    otpRequestLock.current = true;
    setRequestingOtp(true);
    setActionError("");
    try {
      const response = await axios.post(
        `${api}/manifests/${encodeURIComponent(selectedManifest.id)}/stops/${encodeURIComponent(selectedStop.id)}/delivery-otp`,
        {},
        { headers: { token } },
      );
      updateForm("otpRequired", response.data.otpRequired !== false);
      setActionNotice(response.data.message || "Customer delivery verification was requested.");
    } catch (error) {
      setActionError(error.response?.data?.message || "Could not request the customer delivery code.");
    } finally {
      otpRequestLock.current = false;
      setRequestingOtp(false);
    }
  };

  const viewEvidence = async (stop, kind) => {
    try {
      const response = await axios.get(
        `${api}/manifests/${encodeURIComponent(selectedManifest.id)}/stops/${encodeURIComponent(stop.id)}/evidence/${kind}`,
        { headers: { token }, responseType: "blob" },
      );
      if (evidencePreview?.url) URL.revokeObjectURL(evidencePreview.url);
      setEvidencePreview({ url: URL.createObjectURL(response.data), kind });
    } catch (error) {
      setActionError(error.response?.data?.message || "Could not retrieve authenticated delivery evidence.");
    }
  };

  const saveDraftStatus = async (draft, updates) => persistDraft({
    ...draft,
    ...updates,
    formSnapshot: updates.formSnapshot || draft.formSnapshot,
    photoBlob: draft.photoBlob,
    photoName: draft.photoName,
    photoType: draft.photoType,
    photoLastModified: draft.photoLastModified,
    signatureBlob: draft.signatureBlob,
    codPaymentRequired: draft.codPaymentRequired,
    parcelCount: draft.parcelCount,
    idempotencyKey: draft.idempotencyKey,
    deviceTimestamp: draft.deviceTimestamp,
  });

  const makeDraftFormData = async (draft, liveForm = null) => {
    const restored = liveForm || await draftFormForEditing(draft);
    const signatureData = draft.signatureBlob
      ? await blobToDataUrl(draft.signatureBlob)
      : restored.signatureData;
    const photo = draft.photoBlob
      ? new File([draft.photoBlob], draft.photoName || "delivery-photo", {
        type: draft.photoType || draft.photoBlob.type,
        lastModified: draft.photoLastModified || Date.now(),
      })
      : null;
    const submissionForm = {
      ...restored,
      photo,
      signatureData,
      otpCode: liveForm?.otpCode || "",
      collectionConfirmed: Boolean(liveForm?.collectionConfirmed),
    };
    const data = new FormData();
    Object.entries(buildPodCompletionPayload({
      form: submissionForm,
      idempotencyKey: draft.idempotencyKey,
      isUnpaidCod: draft.codPaymentRequired,
    })).forEach(([key, value]) => data.append(key, value));
    data.append("clientDraftId", draft.idempotencyKey);
    data.append("manifestId", draft.manifestId);
    data.append("stopId", draft.stopId);
    data.append("deviceTimestamp", draft.deviceTimestamp);
    return data;
  };

  const sendDraftToServer = async (draft, liveForm = null) => {
    const attempt = draft.syncAttempts + 1;
    const syncing = await saveDraftStatus(draft, {
      status: "SYNCING",
      syncAttempts: attempt,
      nextRetryAt: null,
      conflictCode: "",
      conflictMessage: "",
    });
    let requestStarted = false;
    try {
      const body = await makeDraftFormData(syncing, liveForm);
      requestStarted = true;
      const response = await axios.post(
        `${api}/manifests/${encodeURIComponent(syncing.manifestId)}/stops/${encodeURIComponent(syncing.stopId)}/offline-sync`,
        body,
        { headers: { token } },
      );
      if (!response.data?.success || response.data?.status !== "SYNCED") {
        throw new Error("The server did not confirm delivery synchronization.");
      }
      const confirmed = await saveDraftStatus(syncing, {
        status: "SERVER_CONFIRMED",
        nextRetryAt: null,
        conflictCode: "",
        conflictMessage: "",
      });
      setLastSyncAt(response.data.reconciledAt || new Date().toISOString());
      try {
        await setOfflineSyncMetadata(offlineScope, {
          lastSyncAt: response.data.reconciledAt || new Date().toISOString(),
        });
      } catch (storageError) {
        setStorageWarning(storageError.message || "Delivery was confirmed, but local sync metadata could not be saved.");
      }
      return { status: "SERVER_CONFIRMED", draft: confirmed };
    } catch (error) {
      if (!requestStarted) {
        const queued = await saveDraftStatus(syncing, {
          status: "QUEUED",
          nextRetryAt: null,
          conflictCode: "LOCAL_EVIDENCE_UNAVAILABLE",
          conflictMessage: error.message || "Local evidence could not be prepared for synchronization.",
        });
        return { status: "QUEUED", draft: queued, error };
      }
      const responseStatus = Number(error.response?.status || 0);
      const errorCode = String(error.response?.data?.code || "");
      const codRetryableCodes = new Set([
        "COD_COLLECTION_CONFIRMATION_REQUIRED",
        "DELIVERY_OTP_REQUIRED",
        "DELIVERY_OTP_EXPIRED",
        "INVALID_DELIVERY_OTP",
        "DELIVERY_OTP_CONFLICT",
        "DELIVERY_OTP_LOCKED",
        "DELIVERY_OTP_AMOUNT_CHANGED",
        "INVALID_PAYMENT_METHOD",
      ]);
      const isRetryableCodFailure = syncing.codPaymentRequired && codRetryableCodes.has(errorCode);
      const isDefinitiveRejection = responseStatus >= 400 && responseStatus < 500 &&
        responseStatus !== 429 && !isRetryableCodFailure;
      const retryAt = new Date(Date.now() + Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, attempt - 1)))).toISOString();
      const failedDraft = await saveDraftStatus(syncing, isRetryableCodFailure
        ? {
          status: "REQUIRES_ONLINE_COD",
          nextRetryAt: null,
          conflictCode: errorCode,
          conflictMessage: error.response?.data?.message || "Customer COD verification must be completed online.",
        }
        : isDefinitiveRejection
          ? {
            status: "CONFLICT",
            nextRetryAt: null,
            conflictCode: errorCode || "SERVER_REJECTED",
            conflictMessage: error.response?.data?.message || "The server rejected this delivery action.",
          }
          : attempt >= 5
            ? {
              status: "CONFLICT",
              nextRetryAt: null,
              conflictCode: "RETRY_LIMIT_REACHED",
              conflictMessage: "The server outcome is still uncertain. Refresh server state before explicitly allowing another attempt.",
            }
            : {
              status: "AWAITING_RECONCILIATION",
              nextRetryAt: retryAt,
              conflictCode: "",
              conflictMessage: "The request outcome is uncertain. Refresh authoritative manifest state before retrying.",
            });
      if (!isDefinitiveRejection && !isRetryableCodFailure) {
        setNeedsRefresh(true);
        setConnectionState(error.response ? "unavailable" : "offline");
        if (!error.response) setIsOnline(false);
      }
      return { status: failedDraft.status, draft: failedDraft, error };
    }
  };

  const refreshAuthoritativeManifests = async () => {
    if (!navigator.onLine) throw new Error("Reconnect before refreshing authoritative delivery state.");
    const response = await axios.get(`${api}/manifests`, { headers: { token } });
    const freshManifests = response.data.manifests || [];
    setManifests(freshManifests);
    manifestsRef.current = freshManifests;
    setIsOnline(true);
    setConnectionState("online");
    setNeedsRefresh(false);
    if (offlineScope) {
      await saveAssignedManifestSnapshots(offlineScope, freshManifests);
      const drafts = await getDriverDrafts(offlineScope);
      setDriverDrafts(drafts);
      await restoreDraftForms(drafts);
    }
    return freshManifests;
  };

  const syncQueuedDrafts = async () => {
    if (!token || !offlineScope || !navigator.onLine || syncLock.current || submitting) return;
    syncLock.current = true;
    setSyncingQueue(true);
    setActionError("");
    setActionNotice("");
    try {
      const freshManifests = await refreshAuthoritativeManifests();
      const queuedDrafts = await getDriverDrafts(offlineScope);
      setDriverDrafts(queuedDrafts);
      for (const draft of queuedDrafts) {
        if (!["QUEUED", "AWAITING_RECONCILIATION"].includes(draft.status)) continue;
        if (draft.syncAttempts >= 5) {
          await saveDraftStatus(draft, {
            status: "CONFLICT",
            conflictCode: "RETRY_LIMIT_REACHED",
            conflictMessage: "The server outcome is still uncertain. Refresh server state before explicitly allowing another attempt.",
          });
          continue;
        }
        if (draft.nextRetryAt && Date.parse(draft.nextRetryAt) > Date.now()) continue;
        const manifest = freshManifests.find((item) => item.id === draft.manifestId);
        const stop = manifest?.stops?.find((item) => item.id === draft.stopId);
        if (!manifest || !stop) {
          await saveDraftStatus(draft, {
            status: "CONFLICT",
            conflictCode: "ASSIGNMENT_NOT_AVAILABLE",
            conflictMessage: "The manifest or stop is no longer assigned. Local work was retained and not sent.",
          });
          continue;
        }
        if (stop.proof) {
          if (stop.proof.idempotencyKey === draft.idempotencyKey) {
            await saveDraftStatus(draft, { status: "SERVER_CONFIRMED", nextRetryAt: null });
          } else {
            await saveDraftStatus(draft, {
              status: "CONFLICT",
              conflictCode: "SERVER_OUTCOME_DIFFERS",
              conflictMessage: "The server has a different delivery outcome for this stop. Local evidence was retained for review.",
            });
          }
          continue;
        }
        if (manifest.status !== "IN_TRANSIT" ||
            ["DELIVERED", "PARTIAL", "FAILED"].includes(stop.status)) {
          await saveDraftStatus(draft, {
            status: "CONFLICT",
            conflictCode: "STOP_STATE_CHANGED",
            conflictMessage: "The assigned stop is no longer available for this delivery action.",
          });
          continue;
        }
        if (Number(draft.parcelCount) !== Number(stop.parcelCount)) {
          await saveDraftStatus(draft, {
            status: "CONFLICT",
            conflictCode: "PARCEL_COUNT_CHANGED",
            conflictMessage: "The server parcel count changed. Review the stop before creating a new draft.",
          });
          continue;
        }
        if (draft.codPaymentRequired && draft.formSnapshot.outcome === "DELIVERED") {
          await saveDraftStatus(draft, {
            status: "REQUIRES_ONLINE_COD",
            nextRetryAt: null,
            conflictMessage: "COD verification and collection confirmation must be completed online.",
          });
          continue;
        }
        const result = await sendDraftToServer(draft);
        if (result.status === "SERVER_CONFIRMED") {
          setActionNotice(`Stop ${stop.stopSequence} delivery outcome synchronized.`);
        } else if (result.status === "AWAITING_RECONCILIATION") {
          setActionError(result.error?.response?.data?.message ||
            "The server outcome is uncertain. No automatic retry was made; refresh server state before retrying.");
          break;
        } else if (result.status === "CONFLICT") {
          setActionError(result.draft.conflictMessage);
        } else if (result.status === "REQUIRES_ONLINE_COD") {
          setActionNotice("A queued COD delivery needs customer verification and explicit collection confirmation online.");
        }
      }
      const latestManifests = await refreshAuthoritativeManifests();
      const latestDrafts = await getDriverDrafts(offlineScope);
      setDriverDrafts(latestDrafts);
      setActionNotice((current) => current || (
        latestDrafts.some((draft) => ["QUEUED", "AWAITING_RECONCILIATION"].includes(draft.status))
          ? "Some actions remain queued. Check retry timing and conflict details."
          : "Delivery synchronization check completed."
      ));
      if (latestManifests.length === 0 && latestDrafts.length) {
        setActionNotice("No manifests are currently assigned. Unsent drafts remain saved but cannot be synchronized.");
      }
    } catch (error) {
      setConnectionState(error.response ? "unavailable" : "offline");
      if (!error.response) setIsOnline(false);
      setNeedsRefresh(true);
      setActionError(error.response?.data?.message ||
        "Could not confirm current server state. No queued delivery action was sent.");
    } finally {
      syncLock.current = false;
      setSyncingQueue(false);
    }
  };

  const retryAfterReview = async (draft) => {
    if (!window.confirm("Refresh the server, confirm this stop is still assigned and uncompleted, then allow one more sync attempt?")) return;
    try {
      const freshManifests = await refreshAuthoritativeManifests();
      const manifest = freshManifests.find((item) => item.id === draft.manifestId);
      const stop = manifest?.stops?.find((item) => item.id === draft.stopId);
      if (stop?.proof) {
        await saveDraftStatus(draft, stop.proof.idempotencyKey === draft.idempotencyKey
          ? { status: "SERVER_CONFIRMED", nextRetryAt: null }
          : {
            status: "CONFLICT",
            conflictCode: "SERVER_OUTCOME_DIFFERS",
            conflictMessage: "The server has a different delivery outcome for this stop. Local evidence was retained for review.",
          });
        return;
      }
      if (!manifest || !stop || manifest.status !== "IN_TRANSIT" ||
          ["DELIVERED", "PARTIAL", "FAILED"].includes(stop.status) ||
          Number(draft.parcelCount) !== Number(stop.parcelCount)) {
        await saveDraftStatus(draft, {
          status: "CONFLICT",
          conflictCode: "STOP_STATE_CHANGED",
          conflictMessage: "The stop cannot be safely retried with the current server state.",
        });
        return;
      }
      await saveDraftStatus(draft, {
        status: "QUEUED",
        syncAttempts: 0,
        nextRetryAt: null,
        conflictCode: "",
        conflictMessage: "",
      });
      await syncQueuedDrafts();
    } catch (error) {
      setActionError(error.response?.data?.message || error.message ||
        "Could not verify this stop. The local draft was not retried.");
    }
  };

  const removeLocalDraft = async (draft) => {
    if (!["DRAFT", "CONFLICT", "SERVER_CONFIRMED"].includes(draft.status)) return;
    if (!window.confirm("Delete this local draft and its saved photo/signature from this device? This cannot be undone.")) return;
    try {
      await deleteDriverDraft(offlineScope, draft.manifestId, draft.stopId);
      setDriverDrafts((current) => current.filter((item) => (
        item.manifestId !== draft.manifestId || item.stopId !== draft.stopId
      )));
      formDrafts.current.delete(getStopDraftKey(draft.manifestId, draft.stopId));
      setActionNotice("Local draft and evidence deleted from this device.");
    } catch (error) {
      setStorageWarning(error.message || "The local draft could not be deleted.");
    }
  };

  const clearLocalDriverData = async () => {
    if (!offlineScope || !window.confirm("Delete all saved manifests, delivery drafts, and evidence for this driver account from this device? This cannot be undone and does not change server records.")) return;
    try {
      await clearDriverOfflineData(offlineScope);
      setDriverDrafts([]);
      setManifests([]);
      setSelectedManifestId("");
      setSelectedStopId("");
      selectedManifestIdRef.current = "";
      selectedStopIdRef.current = "";
      currentDraftKey.current = "";
      formDrafts.current.clear();
      formRef.current = initialForm;
      setForm(initialForm);
      setLastSyncAt("");
      setActionNotice("Saved driver data and evidence were deleted from this device only.");
    } catch (error) {
      setStorageWarning(error.message || "Saved driver data could not be deleted.");
    }
  };

  const submitProof = async (event) => {
    event.preventDefault();
    if (!selectedManifest || !selectedStop || submitting || submitLock.current || needsRefresh || pageError) return;
    const browserOnline = navigator.onLine && isOnline && connectionState === "online";
    const validationMessage = validatePodForm({
      ...form,
      parcelCount: selectedStop.parcelCount,
      hasPhoto: Boolean(form.photo),
      hasSignature: Boolean(form.signatureData),
      isUnpaidCod: isUnpaidCod && browserOnline,
    });
    if (validationMessage) {
      setActionError(validationMessage);
      return;
    }
    if (form.photo && form.photo.size > 8 * 1024 * 1024) {
      setActionError("Delivery photo must be 8 MB or smaller.");
      return;
    }
    if (!window.confirm(browserOnline
      ? `Record ${prettyStatus(form.outcome).toLowerCase()} for stop ${selectedStop.stopSequence}?`
      : `Save ${prettyStatus(form.outcome).toLowerCase()} as an unsent local draft for stop ${selectedStop.stopSequence}?`)) return;

    submitLock.current = true;
    const fingerprint = buildPodSubmissionFingerprint(form);
    const draftKey = getStopDraftKey(selectedManifest.id, selectedStop.id);
    setSubmitting(true);
    setActionError("");
    try {
      const currentDraft = offlineScope
        ? await getDriverDraft(offlineScope, selectedManifest.id, selectedStop.id)
        : null;
      const idempotencyKey = currentDraft?.idempotencyKey || getPodIdempotencyKey(
        retrySubmission.current,
        fingerprint,
        () => crypto.randomUUID(),
      );
      retrySubmission.current = { fingerprint, key: idempotencyKey };
      let savedDraft = currentDraft;
      if (offlineScope) {
        savedDraft = await persistDraft({
          manifestId: selectedManifest.id,
          stopId: selectedStop.id,
          form,
          status: browserOnline ? "SYNCING" : (isUnpaidCod && form.outcome === "DELIVERED" ? "REQUIRES_ONLINE_COD" : "QUEUED"),
          codPaymentRequired: isUnpaidCod,
          parcelCount: selectedStop.parcelCount,
          idempotencyKey,
          syncAttempts: currentDraft?.syncAttempts || 0,
          offlineCollectionClaim: currentDraft?.formSnapshot?.codCollectionClaim,
        });
      } else if (!browserOnline) {
        throw new Error("Persistent offline storage is unavailable. Reconnect before recording this delivery.");
      }
      if (!browserOnline) {
        setActionNotice(isUnpaidCod && form.outcome === "DELIVERED"
          ? "The COD draft and evidence are saved on this device. Request a customer code or confirm collection while online; no delivery or payment has been recorded."
          : "Delivery draft and evidence saved on this device. It has not been sent to the server.");
        setActionError("");
        return;
      }
      if (savedDraft) {
        const result = await sendDraftToServer(savedDraft, form);
        if (result.status === "SERVER_CONFIRMED") {
          formDrafts.current.delete(draftKey);
          formRef.current = initialForm;
          setForm(initialForm);
          setActionNotice("Server confirmed the delivery outcome.");
          setNeedsRefresh(false);
          await loadData();
        } else if (result.status === "REQUIRES_ONLINE_COD") {
          setActionError(result.draft.conflictMessage);
          setActionNotice("COD verification was rejected. Request a fresh code or confirm collection, then submit again online.");
        } else if (result.status === "CONFLICT") {
          setActionError(result.draft.conflictMessage);
        } else {
          setNeedsRefresh(true);
          setActionError(result.error?.response?.data?.message ||
            "The server outcome is uncertain. Refresh authoritative state before retrying; your local draft is preserved.");
        }
      } else {
        const body = new FormData();
        Object.entries(buildPodCompletionPayload({ form, idempotencyKey, isUnpaidCod }))
          .forEach(([key, value]) => body.append(key, value));
        await axios.post(
          `${api}/manifests/${encodeURIComponent(selectedManifest.id)}/stops/${encodeURIComponent(selectedStop.id)}/complete`,
          body,
          { headers: { token } },
        );
        setActionNotice("Delivery outcome recorded by the server. Persistent local storage is unavailable.");
        await loadData();
      }
    } catch (error) {
      const ambiguous = isPodSubmissionOutcomeUncertain(error);
      setNeedsRefresh(ambiguous || error.code === "OFFLINE_STORAGE_TRANSACTION_FAILED");
      setActionNotice("");
      setActionError(ambiguous
        ? "The server outcome could not be confirmed. Refresh assigned manifest data before retrying; your form and evidence are preserved locally."
        : error.response?.data?.message || "The server rejected this delivery outcome. Review the form and try again.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const selectedAddress = addressText(selectedStop?.address);
  const selectedPhone = stopPhone(selectedStop?.address);
  const mapUrl = buildDriverMapUrl(selectedStop?.address);
  const queuedCount = driverDrafts.filter((draft) => (
    ["QUEUED", "AWAITING_RECONCILIATION"].includes(draft.status)
  )).length;
  const localWorkCount = driverDrafts.filter((draft) => (
    ["DRAFT", "QUEUED", "AWAITING_RECONCILIATION", "REQUIRES_ONLINE_COD", "CONFLICT"].includes(draft.status)
  )).length;
  const activeDraftRequiresStatusPanel = activeDraft &&
    !["DRAFT", "REQUIRES_ONLINE_COD", "SERVER_CONFIRMED"].includes(activeDraft.status);

  if (loading && !manifests.length) {
    return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600" role="status"><LoaderCircle className="h-5 w-5 animate-spin" />Loading assigned deliveries…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">Driver operations</p>
          <h1 className="mt-1 text-2xl font-black text-[#171717]">Assigned deliveries</h1>
          <p className="mt-1 text-sm text-slate-600">{driver?.name || "Driver"} · Follow the assigned manifest sequence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {queuedCount > 0 && (
            <button type="button" onClick={syncQueuedDrafts} disabled={!isOnline || connectionState !== "online" || syncingQueue || submitting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-800 px-3 text-sm font-bold text-white disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${syncingQueue ? "animate-spin" : ""}`} />
              {syncingQueue ? "Checking and syncing…" : `Sync saved actions (${queuedCount})`}
            </button>
          )}
          {offlineScope && (manifests.length > 0 || driverDrafts.length > 0) && (
            <button type="button" onClick={clearLocalDriverData} disabled={loading || submitting || syncingQueue} className="inline-flex min-h-11 items-center rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800 disabled:opacity-50">
              Clear saved data on this device
            </button>
          )}
          <button type="button" onClick={loadData} disabled={loading || submitting || requestingOtp || syncingQueue} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      {!isOnline && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You are offline. Saved manifest data and unsent drafts are available on this device when storage permits. Delivery actions are not recorded until synchronized. COD verification and final collection confirmation require an online connection.</span>
        </div>
      )}
      {isOnline && connectionState === "unavailable" && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          The network is available, but the delivery server could not be reached. Queued actions will not be sent until an authoritative refresh succeeds.
        </div>
      )}
      {storageWarning && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          Persistent offline storage warning: {storageWarning}
        </div>
      )}
      {localWorkCount > 0 && (
        <p className="text-xs text-slate-600" role="status">
          {localWorkCount} local delivery record(s) · last server sync {lastSyncAt ? formatDate(lastSyncAt) : "not yet recorded"}.
          Local work is not counted as completed manifest progress.
        </p>
      )}
      {pageError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{pageError}</div>}

      {!pageError && !manifests.length && (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm">
          <Truck className="mx-auto h-9 w-9 text-slate-400" />
          <h2 className="mt-3 text-lg font-bold text-slate-900">{connectionState === "online" ? "No assigned manifest" : "No saved manifest available"}</h2>
          <p className="mt-1 text-sm text-slate-600">{connectionState === "online"
            ? "Your distributor has not assigned an active delivery route to you yet."
            : "Reconnect and refresh to load an assigned delivery route. No route has been inferred or created offline."}</p>
        </section>
      )}
      {!pageError && driverDrafts.some((draft) => !manifests.some((manifest) => manifest.id === draft.manifestId)) && (
        <section className="space-y-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm" aria-label="Saved drafts without a current assignment">
            <h2 className="text-sm font-bold text-slate-950">Saved drafts without a current assignment</h2>
            <p className="text-xs text-slate-600">These local actions and evidence remain on this device. They will not be sent unless the server confirms the assignment again.</p>
            {driverDrafts.filter((draft) => !manifests.some((manifest) => manifest.id === draft.manifestId)).map((draft) => (
              <div key={getStopDraftKey(draft.manifestId, draft.stopId)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900">{prettyStatus(draft.status)} · stop {draft.stopId}</p>
                  <p className="mt-1 text-xs text-slate-600">{draft.conflictMessage || `Manifest ${draft.manifestId} is not in the current assignment list.`}</p>
                </div>
                <button type="button" onClick={() => removeLocalDraft(draft)} className="min-h-10 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-800">
                  Delete local copy
                </button>
              </div>
            ))}
        </section>
      )}

      {manifests.length > 0 && (
        <>
          {manifests.length > 1 && (
            <label className="block text-sm font-semibold text-slate-800">
              Assigned manifest
              <select value={selectedManifestId} onChange={(event) => selectManifest(event.target.value)} disabled={submitting || requestingOtp || needsRefresh} className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 disabled:opacity-60">
                {manifests.map((manifest) => <option key={manifest.id} value={manifest.id}>{manifest.manifestCode} · {manifest.name} · {prettyStatus(manifest.status)}</option>)}
              </select>
            </label>
          )}

          {selectedManifest && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{selectedManifest.manifestCode}</p>
                  <h2 className="mt-1 text-lg font-black text-slate-950">{selectedManifest.name}</h2>
                  <p className="mt-1 text-xs text-slate-600">{prettyStatus(selectedManifest.status)} · Planned {formatDate(selectedManifest.plannedStartAt)}</p>
                  {selectedManifest.status === "COMPLETED" && <p className="mt-1 text-xs text-slate-600">Completed {formatDate(selectedManifest.completedAt)}</p>}
                </div>
                <div className="min-w-[7rem] text-right">
                  <p className="text-2xl font-black text-slate-950">{progress.completed}<span className="text-base font-semibold text-slate-500">/{progress.total}</span></p>
                  <p className="text-xs text-slate-500">stops completed</p>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Manifest delivery progress" aria-valuemin={0} aria-valuemax={progress.total || 1} aria-valuenow={progress.completed}>
                <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <p className="rounded-lg bg-slate-50 p-2"><strong>{progress.total}</strong> total stops</p>
                <p className="rounded-lg bg-slate-50 p-2"><strong>{progress.remaining}</strong> remaining</p>
                <p className="rounded-lg bg-rose-50 p-2 text-rose-800"><strong>{progress.failed}</strong> failed</p>
                <p className="rounded-lg bg-amber-50 p-2 text-amber-900"><strong>{progress.partial}</strong> partial</p>
              </div>
              {nextStop && (
                <button type="button" onClick={() => selectStop(nextStop)} disabled={submitting || requestingOtp || needsRefresh} className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 text-left text-sm font-semibold text-sky-950 disabled:opacity-60">
                  <MapPin className="h-4 w-4 shrink-0" />Next assigned stop: {nextStop.stopSequence} · {nextStop.order?.orderReference || "Order"}
                </button>
              )}
            </section>
          )}

          {selectedManifest && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <section className="space-y-2" aria-label="Assigned manifest stops">
                <h2 className="px-1 text-sm font-bold text-slate-900">Stops in assigned sequence</h2>
                {(selectedManifest.stops || []).map((stop) => {
                  const localDraft = driverDrafts.find((draft) => (
                    draft.manifestId === selectedManifest.id && draft.stopId === stop.id
                  ));
                  return (
                    <button type="button" key={stop.id} onClick={() => selectStop(stop)} disabled={submitting || requestingOtp || needsRefresh} aria-pressed={stop.id === selectedStopId} className={`min-h-20 w-full rounded-xl border p-3 text-left disabled:opacity-60 ${stop.id === selectedStopId ? "border-sky-700 bg-sky-50" : "border-slate-200 bg-white"}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-950">Stop {stop.stopSequence} · {stop.order?.orderReference || "Order"}</span>
                        <span className="text-[10px] font-semibold text-slate-600">{prettyStatus(stop.proof?.outcome || stop.status)}</span>
                      </span>
                      <span className="mt-1 block text-xs text-slate-700">{stop.recipientName || "Recipient not specified"}</span>
                      <span className="mt-1 block text-xs text-slate-500">{addressText(stop.address) || "Delivery address unavailable"}</span>
                      {localDraft && <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-950">Local: {prettyStatus(localDraft.status)}</span>}
                    </button>
                  );
                })}
              </section>

              <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                {!selectedStop ? (
                  <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">Select a stop to view its delivery details.</div>
                ) : (
                  <>
                    <div className="border-b border-slate-100 pb-3">
                      <h2 className="text-lg font-black text-slate-950">Stop {selectedStop.stopSequence} · {selectedStop.order?.orderReference || "Order"}</h2>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{selectedStop.recipientName || "Recipient"}</p>
                      <p className="mt-1 text-sm text-slate-600">{selectedAddress || "Delivery address unavailable"}</p>
                      {selectedPhone && <a className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-sky-800 underline" href={`tel:${encodeURIComponent(selectedPhone)}`}><Phone className="h-4 w-4" />{selectedPhone}</a>}
                      {mapUrl && <a className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-bold text-sky-900 sm:w-auto" href={mapUrl} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" />Navigate to saved address</a>}
                      <p className="mt-2 text-xs text-slate-600">{selectedStop.parcelCount} parcel(s) · {prettyStatus(selectedStop.proof?.outcome || selectedStop.status)}</p>
                      {selectedStop.deliveryInstructions && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><strong>Delivery instructions:</strong> {selectedStop.deliveryInstructions}</p>}
                      {selectedStop.order?.codPaymentRequired && (
                        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-950">
                          COD collection required{selectedStop.order.codAmountDue != null && Number.isFinite(Number(selectedStop.order.codAmountDue))
                            ? `: ${currency}${Number(selectedStop.order.codAmountDue).toLocaleString()}`
                            : " (amount is unavailable offline; verify online before collection)."}
                        </p>
                      )}
                      {actionError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{actionError}</p>}
                      {actionNotice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{actionNotice}</p>}
                    </div>

                    {selectedStop.order?.items?.length > 0 && (
                      <div className="py-3">
                        <h3 className="text-sm font-bold text-slate-900">Order items</h3>
                        <ul className="mt-2 divide-y divide-slate-100">
                          {selectedStop.order.items.map((item, index) => (
                            <li key={`${item.sku}-${item.size}-${index}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                              <span className="min-w-0">
                                <span className="block font-semibold text-slate-800">{item.name}</span>
                                <span className="block text-xs text-slate-500">{[item.sku, item.color, item.size].filter(Boolean).join(" · ") || "Item details"}</span>
                              </span>
                              <span className="shrink-0 font-bold text-slate-900">× {item.quantity}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedStop.proof ? (
                      <div className="space-y-3 pt-3">
                        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
                          <p className="font-bold"><Check className="mr-1 inline h-4 w-4" />{prettyStatus(selectedStop.proof.outcome)} recorded</p>
                          <p className="mt-1 text-xs">Recipient: {selectedStop.proof.recipientName} · {formatDate(selectedStop.proof.verifiedAt)}</p>
                          {selectedStop.proof.notes && <p className="mt-2 text-xs">{selectedStop.proof.notes}</p>}
                          {selectedStop.proof.failedReason && <p className="mt-1 text-xs">Reason: {selectedStop.proof.failedReason}</p>}
                          {selectedStop.proof.partialQuantity && <p className="mt-1 text-xs">Parcels delivered: {selectedStop.proof.partialQuantity} of {selectedStop.parcelCount}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedStop.proof.hasPhoto && <button type="button" onClick={() => viewEvidence(selectedStop, "photo")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" />View delivery photo</button>}
                          {selectedStop.proof.hasSignature && <button type="button" onClick={() => viewEvidence(selectedStop, "signature")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" />View signature</button>}
                          {activeDraft?.status === "SERVER_CONFIRMED" && <button type="button" onClick={() => removeLocalDraft(activeDraft)} className="inline-flex min-h-10 items-center rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-800">Delete local copy</button>}
                        </div>
                      </div>
                    ) : activeDraftRequiresStatusPanel ? (
                      <div className="space-y-3 pt-3">
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
                          <p className="font-bold">{prettyStatus(activeDraft.status)}</p>
                          <p className="mt-1">{activeDraft.conflictMessage || "This local action is not server-confirmed."}</p>
                          {activeDraft.formSnapshot.codCollectionClaim && (
                            <p className="mt-2 text-xs">A collection claim was saved locally; it is not payment verification and must be confirmed online.</p>
                          )}
                        </div>
                        {["QUEUED", "AWAITING_RECONCILIATION"].includes(activeDraft.status) && (
                          <button type="button" onClick={syncQueuedDrafts} disabled={!isOnline || connectionState !== "online" || syncingQueue || submitting} className="min-h-11 w-full rounded-lg bg-sky-800 px-3 text-sm font-bold text-white disabled:opacity-50">
                            Refresh server state and sync saved action
                          </button>
                        )}
                        {activeDraft.conflictCode === "RETRY_LIMIT_REACHED" && (
                          <button type="button" onClick={() => retryAfterReview(activeDraft)} disabled={!isOnline || connectionState !== "online" || syncingQueue || submitting} className="min-h-11 w-full rounded-lg border border-amber-400 bg-white px-3 text-sm font-bold text-amber-950 disabled:opacity-50">
                            Review server state before one more attempt
                          </button>
                        )}
                        {["CONFLICT", "SERVER_CONFIRMED"].includes(activeDraft.status) && (
                          <button type="button" onClick={() => removeLocalDraft(activeDraft)} className="min-h-11 w-full rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800">
                            Delete local draft and evidence
                          </button>
                        )}
                      </div>
                    ) : (
                      <form onSubmit={submitProof} className="space-y-3 pt-3">
                        {activeDraft?.status === "DRAFT" && (
                          <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                            Draft fields and evidence are saved on this device. They are not server-confirmed until submitted online or explicitly synchronized.
                          </p>
                        )}
                        {activeDraft?.status === "REQUIRES_ONLINE_COD" && (
                          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                            COD is not queued for sync. Request customer verification or make the required collection claim online; the previously saved claim is not treated as confirmation.
                          </p>
                        )}
                        {selectedManifest.status !== "IN_TRANSIT" && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">This manifest has not been dispatched. You can review details but cannot record an outcome yet.</p>}
                        <label className="block text-sm font-semibold text-slate-800">
                          Delivery outcome
                          <select value={form.outcome} onChange={(event) => updateForm("outcome", event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">
                            <option value="DELIVERED">Delivered</option>
                            <option value="PARTIAL">Partially delivered</option>
                            <option value="FAILED">Failed delivery</option>
                          </select>
                        </label>
                        <label className="block text-sm font-semibold text-slate-800">
                          Recipient name
                          <input required maxLength={191} value={form.recipientName} onChange={(event) => updateForm("recipientName", event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
                        </label>
                        {form.outcome === "PARTIAL" && (
                          <label className="block text-sm font-semibold text-slate-800">
                            Parcels delivered (of {selectedStop.parcelCount})
                            <input required type="number" min="1" max={Math.max(1, Number(selectedStop.parcelCount || 1) - 1)} step="1" value={form.partialQuantity} onChange={(event) => updateForm("partialQuantity", event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
                          </label>
                        )}
                        {form.outcome === "FAILED" && (
                          <label className="block text-sm font-semibold text-slate-800">
                            Failure reason
                            <input required maxLength={191} value={form.failedReason} onChange={(event) => updateForm("failedReason", event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" />
                          </label>
                        )}
                        <div className="rounded-xl border border-slate-200 p-3">
                          <label className="block text-sm font-semibold text-slate-800">
                            Delivery photo (optional; JPG/PNG, max 8 MB)
                            <input type="file" accept="image/jpeg,image/png" onChange={(event) => updateForm("photo", event.target.files?.[0] || null)} className="mt-2 block min-h-11 w-full text-sm" />
                          </label>
                          {form.photo && (
                            <div className="mt-2 flex min-h-10 items-center justify-between gap-2 text-xs text-slate-700" role="status">
                              <span className="min-w-0 truncate">Selected photo: {form.photo.name}</span>
                              <button type="button" onClick={() => updateForm("photo", null)} className="shrink-0 rounded px-2 py-1 font-semibold text-rose-800 underline">Remove photo</button>
                            </div>
                          )}
                          <div className="mt-3"><SignatureCapture key={selectedStop.id} value={form.signatureData} onChange={(value) => updateForm("signatureData", value)} /></div>
                        </div>
                        {isUnpaidCod && form.outcome === "DELIVERED" && (
                          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-bold text-amber-950">
                              {selectedStop.order.codAmountDue != null && Number.isFinite(Number(selectedStop.order.codAmountDue))
                                ? `Collect ${currency}${Number(selectedStop.order.codAmountDue).toLocaleString()} before confirming handoff.`
                                : "Verify the COD amount online before collection."}
                            </p>
                            {!isOnline && <p className="text-xs text-amber-950">Customer verification and final collection confirmation are online-only. No COD action will be submitted while disconnected.</p>}
                            <button type="button" disabled={requestingOtp || selectedManifest.status !== "IN_TRANSIT" || !isOnline || connectionState !== "online" || Boolean(pageError)} onClick={requestOtp} className="min-h-11 rounded-lg border border-amber-400 bg-white px-3 text-sm font-bold text-amber-950 disabled:opacity-50">
                              {requestingOtp ? "Requesting…" : "Request customer verification code"}
                            </button>
                            {form.otpRequired ? (
                              <label className="block text-sm font-semibold text-amber-950">
                                Customer code
                                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.otpCode} onChange={(event) => updateForm("otpCode", event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-1 min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3" />
                              </label>
                            ) : (
                              <label className="flex min-h-11 items-start gap-2 text-sm leading-5 text-amber-950">
                                <input type="checkbox" checked={form.collectionConfirmed} onChange={(event) => updateForm("collectionConfirmed", event.target.checked)} className="mt-1 h-4 w-4" />
                                I confirm the full COD amount was collected from the recipient.
                              </label>
                            )}
                            <label className="block text-sm font-semibold text-amber-950">
                              Payment method
                              <select value={form.paymentMethod} onChange={(event) => updateForm("paymentMethod", event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3">
                                <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_WALLET">Mobile wallet</option><option value="CARD">Card</option>
                              </select>
                            </label>
                          </div>
                        )}
                        <label className="block text-sm font-semibold text-slate-800">
                          Delivery notes
                          <textarea maxLength={4000} value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                        </label>
                        {needsRefresh && <button type="button" onClick={loadData} disabled={loading || submitting || !isOnline} className="min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-bold text-amber-950 disabled:opacity-50">Refresh server state before retrying</button>}
                        <button type="submit" disabled={submitting || needsRefresh || selectedManifest.status !== "IN_TRANSIT" || Boolean(pageError)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 text-sm font-bold text-white disabled:opacity-50">
                          {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                          {submitting
                            ? "Saving delivery action…"
                            : (isOnline && connectionState === "online"
                              ? (activeDraft?.status === "REQUIRES_ONLINE_COD" ? "Verify COD and submit online" : "Record delivery outcome online")
                              : (isUnpaidCod && form.outcome === "DELIVERED"
                                ? "Save COD draft for online verification"
                                : "Save unsent delivery draft"))}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {evidencePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Private delivery evidence">
          <div className="max-h-[90vh] w-full max-w-3xl rounded-xl bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Authenticated {evidencePreview.kind}</h2>
              <button type="button" onClick={() => setEvidencePreview(null)} className="min-h-10 rounded px-3 text-sm font-bold">Close</button>
            </div>
            <img src={evidencePreview.url} alt={`Delivery ${evidencePreview.kind}`} className="mx-auto max-h-[75vh] max-w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverDeliveries;
