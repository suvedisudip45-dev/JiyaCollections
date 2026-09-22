import test from "node:test";
import assert from "node:assert/strict";
import { validateFulfillmentTransition } from "../services/fulfillmentStateMachine.js";

test("requires stitching and branding before quality check", () => {
  const result = validateFulfillmentTransition({
    currentStatus: "preparing",
    nextStatus: "quality_check",
    notes: {},
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /stitching and branding/i);
});

test("requires compulsory customer letter before letter-ready stage", () => {
  const result = validateFulfillmentTransition({
    currentStatus: "quality_check",
    nextStatus: "letter_ready",
    notes: { stitchingBrandingCompleted: true, packagingChecklist: {} },
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /customer letter/i);
});

test("requires all mandatory checklist items before checklist completion", () => {
  const result = validateFulfillmentTransition({
    currentStatus: "letter_ready",
    nextStatus: "checklist_complete",
    notes: {
      packagingChecklist: {
        productVerified: true,
        customerLetterIncluded: true,
      },
    },
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /productVerified|sizeColorVerified/);
});

test("requires package details before delivery handoff", () => {
  const result = validateFulfillmentTransition({
    currentStatus: "packed",
    nextStatus: "package_details_complete",
    notes: { packagingChecklist: {} },
    packageData: { packageType: "Box", packageDimensions: "30x20x10" },
  });

  assert.equal(result.valid, false);
  assert.match(result.message, /package weight/i);
});

test("allows the complete workflow sequence", () => {
  const checklist = {
    productVerified: true,
    sizeColorVerified: true,
    stitchingVerified: true,
    brandingVerified: true,
    qualityVerified: true,
    customerLetterIncluded: true,
    addressVerified: true,
    packagingMaterialsVerified: true,
  };

  assert.equal(validateFulfillmentTransition({ currentStatus: "assigned", nextStatus: "accepted" }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "accepted", nextStatus: "preparing", packageData: { stitchingBrandingCompleted: true } }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "preparing", nextStatus: "quality_check", notes: { stitchingBrandingCompleted: true } }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "quality_check", nextStatus: "letter_ready", packageData: { packagingChecklist: checklist } }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "letter_ready", nextStatus: "checklist_complete", packageData: { packagingChecklist: checklist } }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "checklist_complete", nextStatus: "packed", packageData: { packagingChecklist: checklist } }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "packed", nextStatus: "package_details_complete", packageData: { packageWeight: 1.2, packageDimensions: "30x20x10", packageType: "Box" } }).valid, true);
  assert.equal(validateFulfillmentTransition({ currentStatus: "package_details_complete", nextStatus: "ready_for_pickup", packageData: { packageWeight: 1.2, packageDimensions: "30x20x10", packageType: "Box", packagingChecklist: checklist } }).valid, true);
});
