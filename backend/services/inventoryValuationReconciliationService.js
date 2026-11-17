const TOLERANCE = 0.05;
const CONTROL_ACCOUNT = "1140";
const REVIEW_LOCATION_KINDS = new Set(["DAMAGED", "IN_TRANSIT", "QUARANTINE", "RETURN_HOLD", "RETURN_RECEIPT"]);

const round = (amount) => Number(Number(amount || 0).toFixed(2));
const balanceKey = (locationId, inventorySkuId) => JSON.stringify([locationId, inventorySkuId]);

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const buildInventoryValuationReconciliation = ({
  balances = [],
  layerBalances = [],
  locations = [],
  accounts = [],
} = {}) => {
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const layerRowsByBalance = new Map();
  for (const layerBalance of layerBalances) {
    const key = balanceKey(layerBalance.locationId, layerBalance.inventorySkuId);
    const rows = layerRowsByBalance.get(key) || [];
    rows.push(layerBalance);
    layerRowsByBalance.set(key, rows);
  }

  const balancesByKey = new Map();
  const sensitiveLocationQuantities = new Map();
  let platformOnHandQuantity = 0;
  let verifiedLayerQuantity = 0;
  let verifiedLayerValue = 0;
  let uncostedQuantity = 0;
  let excessLayerQuantity = 0;
  let balanceMismatchCount = 0;
  let invalidBalanceCount = 0;
  let invalidCostLayerCount = 0;
  let orphanedLayerBalanceCount = 0;
  let lostLocationOnHandQuantity = 0;
  let lostLocationLayerQuantity = 0;
  let unknownLocationKindCount = 0;

  for (const balance of balances) {
    const key = balanceKey(balance.locationId, balance.inventorySkuId);
    balancesByKey.set(key, balance);
    const location = locationsById.get(balance.locationId);
    const owner = location?.inventoryOwner || balance.inventoryOwner;
    if (owner && owner !== "PLATFORM") continue;

    const quantity = toFiniteNumber(balance.quantityOnHand);
    const onHand = quantity === null ? 0 : quantity;
    const locationKind = String(location?.kind || balance.locationKind || "").toUpperCase();
    const layerRows = layerRowsByBalance.get(key) || [];
    const layerQuantities = layerRows.map((row) => toFiniteNumber(row.quantity));
    const layerCogs = layerRows.map((row) => toFiniteNumber(row.unitCogs));
    const invalidRows = layerRows.filter((row, index) =>
      layerQuantities[index] === null ||
      !Number.isSafeInteger(layerQuantities[index]) ||
      layerQuantities[index] < 0 ||
      layerCogs[index] === null ||
      layerCogs[index] <= 0
    );
    invalidCostLayerCount += invalidRows.length;

    const layerQuantity = layerQuantities.reduce((sum, value) => sum + (value ?? 0), 0);
    const hasInvalidBalance = quantity === null || !Number.isSafeInteger(onHand) || onHand < 0;
    if (hasInvalidBalance) invalidBalanceCount += 1;
    const isLostLocation = locationKind === "LOST";
    if (isLostLocation) {
      lostLocationOnHandQuantity += Math.abs(onHand);
      lostLocationLayerQuantity += layerQuantities.reduce((sum, value) => sum + Math.max(0, value ?? 0), 0);
      if (hasInvalidBalance) balanceMismatchCount += 1;
      continue;
    }

    platformOnHandQuantity += Math.max(0, onHand);
    if (!locationKind) unknownLocationKindCount += 1;
    if (REVIEW_LOCATION_KINDS.has(locationKind)) {
      sensitiveLocationQuantities.set(
        locationKind,
        (sensitiveLocationQuantities.get(locationKind) || 0) + Math.max(0, onHand),
      );
    }

    const quantityMatches = !hasInvalidBalance && layerQuantity === onHand;
    const layersAreValid = invalidRows.length === 0;
    if (!quantityMatches) {
      balanceMismatchCount += 1;
      uncostedQuantity += Math.max(0, onHand - Math.max(0, layerQuantity));
      excessLayerQuantity += Math.max(0, layerQuantity - Math.max(0, onHand));
      continue;
    }
    if (!layersAreValid || !locationKind) continue;

    verifiedLayerQuantity += onHand;
    verifiedLayerValue += layerRows.reduce(
      (sum, row, index) => sum + layerQuantities[index] * layerCogs[index],
      0,
    );
  }

  for (const [key, rows] of layerRowsByBalance) {
    if (balancesByKey.has(key)) continue;
    if (rows.some((row) => {
      const quantity = toFiniteNumber(row.quantity);
      return quantity === null || quantity !== 0;
    })) orphanedLayerBalanceCount += 1;
  }

  const account = accounts.find((row) => String(row.accountCode) === CONTROL_ACCOUNT);
  const glBalance = toFiniteNumber(account?.currentBalance) ?? 0;
  const accountMappingMatches = String(account?.normalBalance || "").toUpperCase() === "DEBIT";
  const variance = round(glBalance - verifiedLayerValue);
  const sensitiveLocations = [...sensitiveLocationQuantities]
    .map(([kind, quantity]) => ({ kind, quantity: round(quantity) }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  const sensitiveLocationQuantity = sensitiveLocations.reduce((sum, row) => sum + row.quantity, 0);
  const sourceIssueCount = balanceMismatchCount
    + invalidBalanceCount
    + invalidCostLayerCount
    + orphanedLayerBalanceCount
    + (lostLocationOnHandQuantity > 0 || lostLocationLayerQuantity > 0 ? 1 : 0)
    + (unknownLocationKindCount > 0 ? 1 : 0)
    + (sensitiveLocationQuantity > 0 ? 1 : 0);
  const isReconciled = Boolean(account)
    && accountMappingMatches
    && Math.abs(variance) <= TOLERANCE
    && sourceIssueCount === 0;

  return {
    coverageStatus: "SOURCE_SCOPED",
    glControlAccount: `${CONTROL_ACCOUNT} Merchandise Inventory`,
    accountExists: Boolean(account),
    accountMappingMatches,
    glBalance: round(glBalance),
    subledgerTotal: round(verifiedLayerValue),
    variance,
    platformOnHandQuantity: round(platformOnHandQuantity),
    verifiedLayerQuantity: round(verifiedLayerQuantity),
    uncostedQuantity: round(uncostedQuantity),
    excessLayerQuantity: round(excessLayerQuantity),
    balanceMismatchCount,
    invalidBalanceCount,
    invalidCostLayerCount,
    orphanedLayerBalanceCount,
    lostLocationOnHandQuantity: round(lostLocationOnHandQuantity),
    lostLocationLayerQuantity: round(lostLocationLayerQuantity),
    unknownLocationKindCount,
    sensitiveLocations,
    sensitiveLocationQuantity: round(sensitiveLocationQuantity),
    sourceIssueCount,
    isReconciled,
    status: isReconciled ? "MATCH" : "REVIEW",
    coverageNote: "Compares Account 1140 with current platform-owned inventory quantities only where InventoryBalance exactly matches non-negative, positive-Cogs production cost layers. Uncosted or mismatched quantities are excluded from the layer subtotal, not valued using Product.costPrice. This source-scoped check does not establish historical openings, supplier/legacy stock completeness, physical existence, legal ownership, or approved valuation treatment; damaged, in-transit, quarantine, and return locations require finance review.",
  };
};
