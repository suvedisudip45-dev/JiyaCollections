export const DRIVER_OFFLINE_DB_NAME = "jiya-driver-offline";
export const DRIVER_OFFLINE_DB_VERSION = 1;
const MANIFEST_STORE = "manifests";
const DRAFT_STORE = "drafts";
const META_STORE = "metadata";
const DRAFT_STATUSES = new Set([
  "DRAFT",
  "QUEUED",
  "SYNCING",
  "AWAITING_RECONCILIATION",
  "REQUIRES_ONLINE_COD",
  "CONFLICT",
  "SERVER_CONFIRMED",
]);

let databasePromise;

const requiredText = (value, label) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required for offline storage.`);
  return text;
};

const getUnverifiedTokenClaims = (token) => {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

export const getDriverAccountIdFromToken = (token) =>
  String(getUnverifiedTokenClaims(token)?.accountId || "");

export const getDriverOfflineTokenRole = (token) =>
  String(getUnverifiedTokenClaims(token)?.role || "").toUpperCase();

export const createDriverOfflineScope = (token, driver) => {
  const accountId = getDriverAccountIdFromToken(token);
  const driverId = String(driver?.id || "");
  const distributorId = String(driver?.distributorId || "");
  if (!accountId || !driverId || !distributorId) return null;
  return {
    accountId,
    driverId,
    distributorId,
    scopeKey: [accountId, driverId, distributorId].map(encodeURIComponent).join("|"),
  };
};

const cleanAddress = (address) => {
  if (typeof address === "string") return address;
  if (!address || typeof address !== "object") return null;
  const allowedFields = [
    "street",
    "address",
    "neighborhood",
    "city",
    "district",
    "province",
    "phone",
    "phoneNumber",
    "contactPhone",
    "deliveryInstructions",
    "instructions",
  ];
  return Object.fromEntries(allowedFields
    .filter((field) => typeof address[field] === "string")
    .map((field) => [field, address[field]]));
};

export const sanitizeDriverManifest = (manifest) => ({
  id: String(manifest?.id || ""),
  manifestCode: String(manifest?.manifestCode || ""),
  name: String(manifest?.name || ""),
  status: String(manifest?.status || ""),
  priority: String(manifest?.priority || ""),
  plannedStartAt: manifest?.plannedStartAt || null,
  plannedEndAt: manifest?.plannedEndAt || null,
  dispatchedAt: manifest?.dispatchedAt || null,
  completedAt: manifest?.completedAt || null,
  stops: (Array.isArray(manifest?.stops) ? manifest.stops : []).map((stop) => ({
    id: String(stop?.id || ""),
    stopSequence: Number(stop?.stopSequence || 0),
    status: String(stop?.status || ""),
    recipientName: String(stop?.recipientName || ""),
    address: cleanAddress(stop?.address),
    parcelCount: Number(stop?.parcelCount || 0),
    completedAt: stop?.completedAt || null,
    deliveryInstructions: String(stop?.deliveryInstructions || ""),
    proof: stop?.proof ? {
      outcome: String(stop.proof.outcome || ""),
      recipientName: String(stop.proof.recipientName || ""),
      notes: String(stop.proof.notes || ""),
      failedReason: String(stop.proof.failedReason || ""),
      partialQuantity: stop.proof.partialQuantity ?? null,
      verifiedAt: stop.proof.verifiedAt || null,
      hasSignature: Boolean(stop.proof.hasSignature),
      hasPhoto: Boolean(stop.proof.hasPhoto),
      idempotencyKey: String(stop.proof.idempotencyKey || ""),
    } : null,
    order: stop?.order ? {
      orderReference: String(stop.order.orderReference || ""),
      items: (Array.isArray(stop.order.items) ? stop.order.items : []).map((item) => ({
        name: String(item?.name || ""),
        sku: String(item?.sku || ""),
        color: String(item?.color || ""),
        size: String(item?.size || ""),
        quantity: Number(item?.quantity || 0),
      })),
      codPaymentRequired: Boolean(stop.order.codPaymentRequired),
    } : null,
  })),
});

const openDatabase = () => {
  if (databasePromise) return databasePromise;
  if (!globalThis.indexedDB) {
    return Promise.reject(Object.assign(
      new Error("This browser does not support persistent offline storage."),
      { code: "OFFLINE_STORAGE_UNAVAILABLE" },
    ));
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DRIVER_OFFLINE_DB_NAME, DRIVER_OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
        const manifests = database.createObjectStore(MANIFEST_STORE, {
          keyPath: ["scopeKey", "manifestId"],
        });
        manifests.createIndex("scopeKey", "scopeKey", { unique: false });
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        const drafts = database.createObjectStore(DRAFT_STORE, {
          keyPath: ["scopeKey", "manifestId", "stopId"],
        });
        drafts.createIndex("scopeKey", "scopeKey", { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "scopeKey" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(Object.assign(
        new Error("Offline storage could not be opened. Check browser storage settings and available space."),
        { code: "OFFLINE_STORAGE_OPEN_FAILED", cause: request.error },
      ));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(Object.assign(
        new Error("Offline storage is waiting for another open tab to close."),
        { code: "OFFLINE_STORAGE_UPGRADE_BLOCKED" },
      ));
    };
  });
  return databasePromise;
};

const runTransaction = async (storeNames, mode, action) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let result;
    let settled = false;
    let transaction;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      transaction = database.transaction(storeNames, mode);
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      transaction.onabort = () => finishReject(Object.assign(
        new Error("Offline storage could not save the requested data."),
        { code: "OFFLINE_STORAGE_TRANSACTION_FAILED", cause: transaction.error },
      ));
      transaction.onerror = () => {};
      const actionResult = action(transaction);
      if (actionResult && typeof actionResult.then === "function") {
        actionResult.then((value) => { result = value; }, (error) => {
          if (transaction && !settled) {
            try {
              transaction.abort();
            } catch {
              finishReject(error);
            }
          }
          finishReject(error);
        });
      } else {
        result = actionResult;
      }
    } catch (error) {
      if (transaction) {
        try {
          transaction.abort();
        } catch {
          finishReject(error);
        }
      }
      finishReject(error);
    }
  });
};

const readAllByScope = (storeName, scopeKey) => runTransaction([storeName], "readonly", (transaction) => {
  const request = transaction.objectStore(storeName).index("scopeKey").getAll(scopeKey);
  request.onerror = () => {};
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("Offline data could not be read."));
  });
});

export const saveAssignedManifestSnapshots = async (scope, manifests) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  const safeManifests = (Array.isArray(manifests) ? manifests : [])
    .map(sanitizeDriverManifest)
    .filter((manifest) => manifest.id);
  const assignedManifestIds = new Set(safeManifests.map((manifest) => manifest.id));
  await runTransaction([MANIFEST_STORE, DRAFT_STORE], "readwrite", (transaction) => {
    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    const draftStore = transaction.objectStore(DRAFT_STORE);
    const oldManifestCursor = manifestStore.index("scopeKey").openCursor(scopeKey);
    oldManifestCursor.onsuccess = () => {
      const cursor = oldManifestCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    safeManifests.forEach((manifest) => manifestStore.put({
      scopeKey,
      manifestId: manifest.id,
      cachedAt: new Date().toISOString(),
      manifest,
    }));
    const draftCursor = draftStore.index("scopeKey").openCursor(scopeKey);
    draftCursor.onsuccess = () => {
      const cursor = draftCursor.result;
      if (!cursor) return;
      const draft = cursor.value;
      if (!assignedManifestIds.has(draft.manifestId) &&
          !["SERVER_CONFIRMED", "CONFLICT"].includes(draft.status)) {
        cursor.update({
          ...draft,
          status: "CONFLICT",
          conflictCode: "MANIFEST_NOT_ASSIGNED",
          conflictMessage: "This manifest is no longer assigned. Local work was retained and will not sync.",
          updatedAt: new Date().toISOString(),
        });
      }
      cursor.continue();
    };
  });
};

export const clearAssignedManifestSnapshots = async (scope, reason = "DRIVER_ACCESS_REVOKED") => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  await runTransaction([MANIFEST_STORE, DRAFT_STORE], "readwrite", (transaction) => {
    const manifests = transaction.objectStore(MANIFEST_STORE).index("scopeKey").openCursor(scopeKey);
    manifests.onsuccess = () => {
      const cursor = manifests.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    const drafts = transaction.objectStore(DRAFT_STORE).index("scopeKey").openCursor(scopeKey);
    drafts.onsuccess = () => {
      const cursor = drafts.result;
      if (!cursor) return;
      const draft = cursor.value;
      if (draft.status !== "SERVER_CONFIRMED") {
        cursor.update({
          ...draft,
          status: "CONFLICT",
          conflictCode: reason,
          conflictMessage: "Driver access could not be verified. Local work was retained and will not sync.",
          updatedAt: new Date().toISOString(),
        });
      }
      cursor.continue();
    };
  });
};

export const getCachedAssignedManifests = (scope) =>
  readAllByScope(MANIFEST_STORE, requiredText(scope?.scopeKey, "Driver account scope"))
    .then((records) => records.map((record) => record.manifest));

export const getDriverDrafts = (scope) =>
  readAllByScope(DRAFT_STORE, requiredText(scope?.scopeKey, "Driver account scope"))
    .then((drafts) => drafts.sort((left, right) => left.createdAt.localeCompare(right.createdAt)));

export const getDriverDraft = async (scope, manifestId, stopId) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  return runTransaction([DRAFT_STORE], "readonly", (transaction) => {
    const request = transaction.objectStore(DRAFT_STORE)
      .get([scopeKey, requiredText(manifestId, "Manifest"), requiredText(stopId, "Stop")]);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Offline delivery draft could not be read."));
    });
  });
};

export const saveDriverDraft = async (scope, input) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  const manifestId = requiredText(input?.manifestId, "Manifest");
  const stopId = requiredText(input?.stopId, "Stop");
  const status = DRAFT_STATUSES.has(input?.status) ? input.status : "DRAFT";
  const now = new Date().toISOString();
  const form = input?.form || {};
  const existing = await getDriverDraft(scope, manifestId, stopId);
  const photo = form.photo instanceof Blob
    ? form.photo
    : Object.hasOwn(form, "photo")
      ? null
      : input?.photoBlob || existing?.photoBlob || null;
  const signatureBlob = Object.hasOwn(form, "signatureData")
    ? (form.signatureData ? dataUrlToBlob(form.signatureData) : null)
    : input?.signatureBlob || existing?.signatureBlob || null;
  const formValue = (field, fallback) => (
    Object.hasOwn(form, field) ? form[field] : fallback
  );
  const snapshot = {
    outcome: String(formValue("outcome", input?.formSnapshot?.outcome || "DELIVERED")),
    recipientName: String(formValue("recipientName", input?.formSnapshot?.recipientName || "")),
    notes: String(formValue("notes", input?.formSnapshot?.notes || "")),
    partialQuantity: String(formValue("partialQuantity", input?.formSnapshot?.partialQuantity || "")),
    failedReason: String(formValue("failedReason", input?.formSnapshot?.failedReason || "")),
    paymentMethod: String(formValue("paymentMethod", input?.formSnapshot?.paymentMethod || "CASH")),
    codCollectionClaim: Boolean(
      form.collectionConfirmed ||
      input?.offlineCollectionClaim ||
      input?.formSnapshot?.codCollectionClaim ||
      existing?.formSnapshot?.codCollectionClaim,
    ),
  };
  const draft = {
    scopeKey,
    accountId: scope.accountId,
    driverId: scope.driverId,
    distributorId: scope.distributorId,
    manifestId,
    stopId,
    idempotencyKey: existing?.idempotencyKey || input?.idempotencyKey || crypto.randomUUID(),
    status,
    formSnapshot: snapshot,
    photoBlob: photo ? new Blob([photo], { type: photo.type || "application/octet-stream" }) : null,
    photoName: Object.hasOwn(form, "photo")
      ? form.photo?.name || ""
      : input?.photoName || existing?.photoName || "",
    photoType: Object.hasOwn(form, "photo")
      ? photo?.type || ""
      : input?.photoType || existing?.photoType || "",
    photoLastModified: Object.hasOwn(form, "photo")
      ? form.photo?.lastModified || null
      : input?.photoLastModified || existing?.photoLastModified || null,
    signatureBlob,
    codPaymentRequired: Boolean(input?.codPaymentRequired),
    parcelCount: Number(input?.parcelCount || 0),
    conflictCode: input?.conflictCode || existing?.conflictCode || "",
    conflictMessage: input?.conflictMessage || existing?.conflictMessage || "",
    syncAttempts: Number(input?.syncAttempts ?? existing?.syncAttempts ?? 0),
    nextRetryAt: input?.nextRetryAt || existing?.nextRetryAt || null,
    deviceTimestamp: input?.deviceTimestamp || existing?.deviceTimestamp || now,
    createdAt: existing?.createdAt || input?.createdAt || now,
    updatedAt: now,
  };
  await runTransaction([DRAFT_STORE], "readwrite", (transaction) => {
    transaction.objectStore(DRAFT_STORE).put(draft);
  });
  return draft;
};

export const deleteDriverDraft = async (scope, manifestId, stopId) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  await runTransaction([DRAFT_STORE], "readwrite", (transaction) => {
    transaction.objectStore(DRAFT_STORE)
      .delete([scopeKey, requiredText(manifestId, "Manifest"), requiredText(stopId, "Stop")]);
  });
};

export const clearDriverOfflineData = async (scope) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  await runTransaction([MANIFEST_STORE, DRAFT_STORE, META_STORE], "readwrite", (transaction) => {
    for (const storeName of [MANIFEST_STORE, DRAFT_STORE]) {
      const request = transaction.objectStore(storeName).index("scopeKey").openCursor(scopeKey);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    }
    transaction.objectStore(META_STORE).delete(scopeKey);
    transaction.objectStore(META_STORE).delete(`driver-profile:${encodeURIComponent(scope.accountId)}`);
  });
};

export const saveCachedDriverProfile = async (token, driver) => {
  const accountId = getDriverAccountIdFromToken(token);
  const profileId = requiredText(driver?.id, "Driver profile");
  const distributorId = requiredText(driver?.distributorId, "Distributor profile");
  if (!accountId) throw new Error("Authenticated driver account identity is unavailable.");
  const profile = {
    id: profileId,
    distributorId,
    name: String(driver?.name || ""),
    status: String(driver?.status || ""),
    vehicleType: String(driver?.vehicleType || ""),
    vehicleRegistration: String(driver?.vehicleRegistration || ""),
  };
  await runTransaction([META_STORE], "readwrite", (transaction) => {
    transaction.objectStore(META_STORE).put({
      scopeKey: `driver-profile:${encodeURIComponent(accountId)}`,
      profile,
      cachedAt: new Date().toISOString(),
    });
  });
  return profile;
};

export const getCachedDriverProfile = async (token) => {
  const accountId = getDriverAccountIdFromToken(token);
  if (!accountId) return null;
  return runTransaction([META_STORE], "readonly", (transaction) => {
    const request = transaction.objectStore(META_STORE)
      .get(`driver-profile:${encodeURIComponent(accountId)}`);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result?.profile || null);
      request.onerror = () => reject(request.error || new Error("Cached driver profile could not be read."));
    });
  });
};

export const getOfflineSyncMetadata = async (scope) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  return runTransaction([META_STORE], "readonly", (transaction) => {
    const request = transaction.objectStore(META_STORE).get(scopeKey);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Offline sync status could not be read."));
    });
  });
};

export const setOfflineSyncMetadata = async (scope, updates) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  const current = await getOfflineSyncMetadata(scope);
  await runTransaction([META_STORE], "readwrite", (transaction) => {
    transaction.objectStore(META_STORE).put({
      ...(current || {}),
      ...updates,
      scopeKey,
    });
  });
};

export const cleanupConfirmedDriverDrafts = async (scope, retentionDays = 30) => {
  const scopeKey = requiredText(scope?.scopeKey, "Driver account scope");
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await runTransaction([DRAFT_STORE], "readwrite", (transaction) => {
    const cursorRequest = transaction.objectStore(DRAFT_STORE).index("scopeKey").openCursor(scopeKey);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const draft = cursor.value;
      if (draft.status === "SERVER_CONFIRMED" && Date.parse(draft.updatedAt) < cutoff) cursor.delete();
      cursor.continue();
    };
  });
};

export const draftFormForEditing = async (draft) => ({
  outcome: draft?.formSnapshot?.outcome || "DELIVERED",
  recipientName: draft?.formSnapshot?.recipientName || "",
  notes: draft?.formSnapshot?.notes || "",
  partialQuantity: draft?.formSnapshot?.partialQuantity || "",
  failedReason: draft?.formSnapshot?.failedReason || "",
  photo: draft?.photoBlob && typeof File !== "undefined"
    ? new File([draft.photoBlob], draft.photoName || "delivery-photo", {
      type: draft.photoType || draft.photoBlob.type,
      lastModified: draft.photoLastModified || Date.now(),
    })
    : null,
  signatureData: draft?.signatureBlob ? await blobToDataUrl(draft.signatureBlob) : "",
  otpCode: "",
  otpRequired: true,
  collectionConfirmed: false,
  paymentMethod: draft?.formSnapshot?.paymentMethod || "CASH",
});

export const dataUrlToBlob = (dataUrl) => {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Signature evidence is not a valid data URL.");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
};

export const blobToDataUrl = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
};
