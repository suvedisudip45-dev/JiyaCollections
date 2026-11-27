export const validatePodForm = ({
  outcome,
  recipientName,
  parcelCount,
  partialQuantity,
  failedReason,
  hasPhoto,
  hasSignature,
  isUnpaidCod,
  otpRequired,
  otpCode,
  collectionConfirmed,
}) => {
  if (!["DELIVERED", "PARTIAL", "FAILED"].includes(outcome)) return "Choose a delivery outcome.";
  if (!String(recipientName || "").trim()) return "Recipient name is required.";
  if (outcome === "DELIVERED" && !hasPhoto && !hasSignature) {
    return "Add a delivery photo or recipient signature.";
  }
  if (outcome === "PARTIAL") {
    const quantity = Number(partialQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity >= Number(parcelCount)) {
      return "Partial quantity must be a positive whole number below the parcel count.";
    }
  }
  if (outcome === "FAILED" && !String(failedReason || "").trim()) {
    return "A failed-delivery reason is required.";
  }
  if (outcome === "DELIVERED" && isUnpaidCod) {
    if (otpRequired && !/^\d{6}$/.test(String(otpCode || "").trim())) {
      return "Enter the 6-digit customer delivery code.";
    }
    if (!otpRequired && !collectionConfirmed) {
      return "Confirm that the full COD amount was collected.";
    }
  }
  return null;
};

export const getDriverManifestProgress = (manifest) => {
  const stops = manifest?.stops || [];
  const completed = stops.filter((stop) => (
    stop.proof || ["DELIVERED", "FAILED", "PARTIAL"].includes(stop.status)
  )).length;
  return {
    total: stops.length,
    completed,
    remaining: Math.max(0, stops.length - completed),
    failed: stops.filter((stop) => stop.proof?.outcome === "FAILED" || stop.status === "FAILED").length,
    partial: stops.filter((stop) => stop.proof?.outcome === "PARTIAL" || stop.status === "PARTIAL").length,
  };
};

export const buildPodSubmissionFingerprint = (form) => JSON.stringify({
  outcome: form.outcome,
  recipientName: String(form.recipientName || "").trim(),
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

export const buildPodCompletionPayload = ({ form, idempotencyKey, isUnpaidCod }) => ({
  outcome: form.outcome,
  recipientName: String(form.recipientName || "").trim(),
  notes: String(form.notes || "").trim(),
  idempotencyKey,
  ...(form.outcome === "PARTIAL" ? { partialQuantity: form.partialQuantity } : {}),
  ...(form.outcome === "FAILED" ? { failedReason: String(form.failedReason || "").trim() } : {}),
  ...(form.signatureData ? { signatureData: form.signatureData } : {}),
  ...(form.photo ? { photo: form.photo } : {}),
  ...(isUnpaidCod && form.outcome === "DELIVERED"
    ? {
      paymentMethod: form.paymentMethod,
      ...(form.otpRequired
        ? { otpCode: String(form.otpCode || "").trim() }
        : { collectionConfirmed: String(form.collectionConfirmed) }),
    }
    : {}),
});

export const getPodIdempotencyKey = (previousSubmission, fingerprint, createKey) => (
  previousSubmission?.fingerprint === fingerprint
    ? previousSubmission.key
    : createKey()
);

export const isPodSubmissionOutcomeUncertain = (error) => (
  !error?.response || Number(error.response.status) >= 500
);

export const buildDriverMapUrl = (address) => {
  const savedAddress = typeof address === "string"
    ? address.trim()
    : [
      address?.street,
      address?.address,
      address?.neighborhood,
      address?.city,
      address?.district,
      address?.province,
    ].filter(Boolean).join(", ");
  return savedAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(savedAddress)}`
    : "";
};

export const validatePeerReceiptLine = ({
  goodQuantity,
  damagedQuantity,
  missingQuantity,
  remainingQuantity,
}) => {
  const quantities = [goodQuantity, damagedQuantity, missingQuantity].map((value) => Number(value || 0));
  if (!quantities.every((quantity) => Number.isSafeInteger(quantity) && quantity >= 0)) {
    return "Good, damaged, and missing quantities must be non-negative whole numbers.";
  }
  const accounted = quantities.reduce((total, quantity) => total + quantity, 0);
  if (accounted < 1) return "Account for at least one unit.";
  if (accounted > Number(remainingQuantity)) return "Receipt quantities exceed the remaining dispatched quantity.";
  return null;
};
