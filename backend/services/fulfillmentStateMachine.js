const WORKFLOW_STEPS = [
  "assigned",
  "accepted",
  "preparing",
  "quality_check",
  "letter_ready",
  "checklist_complete",
  "packed",
  "package_details_complete",
  "ready_for_pickup",
];

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const parseNotes = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const isComplete = (value) => value === true;

const getCurrentIndex = (status) => WORKFLOW_STEPS.indexOf(normalizeStatus(status));

export const getFulfillmentWorkflow = () => WORKFLOW_STEPS;

export const validateFulfillmentTransition = ({ currentStatus, nextStatus, notes = {}, packageData = {} }) => {
  const current = normalizeStatus(currentStatus || "assigned");
  const next = normalizeStatus(nextStatus);
  const currentIndex = getCurrentIndex(current);
  const nextIndex = getCurrentIndex(next);

  if (next === "rejected" || next === "cancelled") {
    if (current !== "assigned") {
      return { valid: false, message: "An order can only be rejected before acceptance." };
    }
    return { valid: true, current, next };
  }

  if (currentIndex === -1 || nextIndex === -1) {
    return { valid: false, message: "Unknown fulfillment workflow stage." };
  }

  if (nextIndex !== currentIndex + 1) {
    if (nextIndex === currentIndex - 1 && currentIndex > 0) {
      return { valid: true, current, next, direction: "backward" };
    }
    return {
      valid: false,
      message: `Complete ${WORKFLOW_STEPS[currentIndex + 1].replace(/_/g, " ")} before moving to ${next.replace(/_/g, " ")}.`,
    };
  }

  const mergedNotes = { ...parseNotes(notes), ...packageData };
  const checklist = mergedNotes.packagingChecklist || mergedNotes.checklist || {};

  if (next === "quality_check" && mergedNotes.stitchingBrandingCompleted !== true) {
    return { valid: false, message: "Confirm stitching and branding before quality check." };
  }

  if (next === "letter_ready" && checklist.customerLetterIncluded !== true) {
    return { valid: false, message: "The customer letter is compulsory. Confirm that it is printed and included." };
  }

  if (next === "checklist_complete") {
    const requiredChecks = [
      "productVerified",
      "sizeColorVerified",
      "stitchingVerified",
      "brandingVerified",
      "qualityVerified",
      "customerLetterIncluded",
      "addressVerified",
      "packagingMaterialsVerified",
    ];
    const missing = requiredChecks.filter((field) => !isComplete(checklist[field]));
    if (missing.length > 0) {
      return { valid: false, message: `Complete all checklist items before continuing: ${missing.join(", ")}.` };
    }
  }

  if (next === "package_details_complete") {
    const weight = Number(mergedNotes.packageWeight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return { valid: false, message: "Enter a valid package weight before continuing." };
    }
    if (!String(mergedNotes.packageDimensions || "").trim()) {
      return { valid: false, message: "Enter package dimensions before continuing." };
    }
    if (!String(mergedNotes.packageType || "").trim()) {
      return { valid: false, message: "Select a package type before continuing." };
    }
  }

  return { valid: true, current, next };
};

export { normalizeStatus, parseNotes };
