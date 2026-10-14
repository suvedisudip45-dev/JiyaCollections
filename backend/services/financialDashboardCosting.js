const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const asAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const resolveUnitAmount = (snapshot, acceptedRate, legacyFallback = 0) =>
  asAmount(snapshot) || asAmount(acceptedRate) || asAmount(legacyFallback);

const roundMoney = (value) => Number(value.toFixed(2));

const addWeightedRates = (map, key, cogs, overhead, quantity) => {
  const weight = Math.max(1, Number(quantity) || 0);
  const current = map.get(key) || { cogs: 0, overhead: 0, quantity: 0 };
  current.cogs += asAmount(cogs) * weight;
  current.overhead += asAmount(overhead) * weight;
  current.quantity += weight;
  map.set(key, current);
};

const weightedRates = (map) => new Map([...map].map(([key, value]) => [
  key,
  {
    unitCogs: value.cogs / value.quantity,
    unitOverhead: value.overhead / value.quantity,
  },
]));

export const calculateFinancialDashboardProductCosts = ({
  orders = [],
  costLayers = [],
  manufacturerInventories = [],
  products = [],
} = {}) => {
  const layerTotals = new Map();
  for (const layer of costLayers) {
    addWeightedRates(
      layerTotals,
      layer.productId,
      layer.unitCogs,
      layer.unitDeliveryCost,
      layer.producedQuantity,
    );
  }

  const approvedInventoryTotals = new Map();
  for (const inventory of manufacturerInventories) {
    if (inventory.priceStatus !== "APPROVED") continue;
    addWeightedRates(
      approvedInventoryTotals,
      inventory.productId,
      inventory.agreedCostPrice,
      0,
      inventory.quantity,
    );
  }

  const productRates = new Map(products.map((product) => [
    product.id,
    {
      unitCogs: asAmount(product.costPrice),
      unitOverhead: 0,
    },
  ]));
  for (const [productId, rates] of weightedRates(approvedInventoryTotals)) {
    productRates.set(productId, rates);
  }
  for (const [productId, rates] of weightedRates(layerTotals)) {
    productRates.set(productId, rates);
  }

  let directCOGS = 0;
  let deliveryAndOtherOverheads = 0;
  let unitsSold = 0;
  for (const order of orders) {
    for (const item of parseItems(order.items)) {
      const quantity = asAmount(item.quantity || 1);
      if (!quantity) continue;
      unitsSold += quantity;
      const productId = item.productId || item._id || item.id;
      const rates = productRates.get(productId) || { unitCogs: 0, unitOverhead: 0 };
      const allocations = Array.isArray(item.productionCostAllocations)
        ? item.productionCostAllocations
        : null;

      if (allocations) {
        let allocatedQuantity = 0;
        for (const allocation of allocations) {
          const allocated = asAmount(allocation.quantity);
          allocatedQuantity += allocated;
          directCOGS += asAmount(allocation.unitCogs) * allocated;
          deliveryAndOtherOverheads += asAmount(allocation.unitDeliveryCost) * allocated;
        }

        const legacyQuantity = Math.max(0, Number(item.legacyCostQuantity ?? (quantity - allocatedQuantity)) || 0);
        if (legacyQuantity) {
          const acceptedUnitCogs = item.legacyUnitCogsVatInclusiveAtAcceptance
            ?? item.agreedUnitCogsVatInclusiveAtAcceptance
            ?? null;
          directCOGS += resolveUnitAmount(acceptedUnitCogs, rates.unitCogs, item.costPrice) * legacyQuantity;
          deliveryAndOtherOverheads += asAmount(item.unitDeliveryCost ?? rates.unitOverhead) * legacyQuantity;
        }
        continue;
      }

      const acceptedUnitCogs = item.legacyUnitCogsVatInclusiveAtAcceptance
        ?? item.agreedUnitCogsVatInclusiveAtAcceptance
        ?? null;
      const unitCogs = resolveUnitAmount(acceptedUnitCogs, rates.unitCogs, item.costPrice);
      const unitOverhead = asAmount(item.unitDeliveryCost ?? item.approvedDeliveryCost ?? rates.unitOverhead);
      directCOGS += unitCogs * quantity;
      deliveryAndOtherOverheads += unitOverhead * quantity;
    }
  }

  return {
    directCOGS: roundMoney(directCOGS),
    deliveryAndOtherOverheads: roundMoney(deliveryAndOtherOverheads),
    unitsSold,
  };
};
