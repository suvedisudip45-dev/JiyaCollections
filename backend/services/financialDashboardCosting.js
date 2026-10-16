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

const getOrderItemProductId = (item) => item.productId || item._id || item.id;

const normalizeProductionCostLayers = (costLayers = []) => {
  const producedByRequest = new Map();
  for (const layer of costLayers) {
    const requestId = layer.productionRequestId;
    if (!requestId || layer.productionRequest?.approvedDeliveryCost == null) continue;
    producedByRequest.set(
      requestId,
      (producedByRequest.get(requestId) || 0) + asAmount(layer.producedQuantity),
    );
  }

  return new Map(costLayers.filter((layer) => layer.id).map((layer) => {
    const request = layer.productionRequest;
    const batchQuantity = request?.approvedDeliveryCost == null
      ? 0
      : producedByRequest.get(layer.productionRequestId) || 0;
    const hasBatchOtherCost = request?.approvedDeliveryCost != null && batchQuantity > 0;
    return [layer.id, {
      ...layer,
      unitCogs: request?.approvedUnitCogs ?? layer.unitCogs,
      unitDeliveryCost: hasBatchOtherCost
        ? Number(request.approvedDeliveryCost) / batchQuantity
        : layer.unitDeliveryCost,
      hasBatchOtherCost,
      batchOtherCost: hasBatchOtherCost ? Number(request.approvedDeliveryCost) : null,
      batchGoodQuantity: hasBatchOtherCost ? batchQuantity : null,
    }];
  }));
};

export const calculateProductFixedOverheadPerSoldUnit = ({ orders = [], costLayers = [] } = {}) => {
  const overheadTotals = new Map();
  const soldQuantities = new Map();
  const costLayersById = normalizeProductionCostLayers(costLayers);

  for (const order of orders) {
    for (const item of parseItems(order.items)) {
      const productId = getOrderItemProductId(item);
      const quantity = asAmount(item.quantity || 1);
      if (!productId || !quantity) continue;
      soldQuantities.set(productId, (soldQuantities.get(productId) || 0) + quantity);

      const allocations = Array.isArray(item.productionCostAllocations)
        ? item.productionCostAllocations
        : null;
      if (allocations) {
        let allocatedQuantity = 0;
        for (const allocation of allocations) {
          const allocated = asAmount(allocation.quantity);
          allocatedQuantity += allocated;
          const costLayer = costLayersById.get(allocation.costLayerId);
          overheadTotals.set(
            productId,
            (overheadTotals.get(productId) || 0) +
              asAmount(costLayer?.unitDeliveryCost ?? allocation.unitDeliveryCost) * allocated,
          );
        }
        const legacyQuantity = Math.max(0, Number(item.legacyCostQuantity ?? (quantity - allocatedQuantity)) || 0);
        const legacyOverhead = asAmount(item.unitDeliveryCost ?? item.approvedDeliveryCost);
        overheadTotals.set(
          productId,
          (overheadTotals.get(productId) || 0) + legacyOverhead * legacyQuantity,
        );
      } else {
        const unitOverhead = asAmount(item.unitDeliveryCost ?? item.approvedDeliveryCost);
        overheadTotals.set(productId, (overheadTotals.get(productId) || 0) + unitOverhead * quantity);
      }
    }
  }

  return new Map([...soldQuantities].map(([productId, soldQuantity]) => {
    const totalOverhead = overheadTotals.get(productId) || 0;
    return [
      productId,
      {
        totalOverhead: roundMoney(totalOverhead),
        soldQuantity,
        unitOverhead: soldQuantity ? totalOverhead / soldQuantity : 0,
      },
    ];
  }));
};

export const calculateAllocatedProductionOverhead = ({ orders = [], overheadPerProduct = new Map() } = {}) => {
  let total = 0;
  for (const order of orders) {
    for (const item of parseItems(order.items)) {
      const productId = getOrderItemProductId(item);
      const quantity = asAmount(item.quantity || 1);
      if (!productId || !quantity) continue;
      total += (overheadPerProduct.get(productId)?.unitOverhead || 0) * quantity;
    }
  }
  return roundMoney(total);
};

export const countPurchaseTransactions = (orders = []) => new Set(
  orders.map((order, index) => order.checkoutGroupId || order.id || `unkeyed-${index}`),
).size;

export const calculateInventoryValuationAtCost = ({
  balances = [],
  ledgerEntries = [],
  products = [],
} = {}) => {
  const remainingByLocationSkuLayer = new Map();
  for (const entry of ledgerEntries) {
    const layerId = entry.productionCostLayerId;
    const rawUnitCogs = entry.productionCostLayer
      ? entry.productionCostLayer.unitCogs
      : entry.unitCogs;
    if (!layerId || rawUnitCogs == null) continue;
    const unitCogs = asAmount(rawUnitCogs);
    if (entry.locationId) {
      const balanceKey = JSON.stringify([entry.locationId, entry.inventorySkuId]);
      const layers = remainingByLocationSkuLayer.get(balanceKey) || new Map();
      layers.set(layerId, {
        quantity: Number(entry.quantity) || 0,
        unitCogs,
      });
      remainingByLocationSkuLayer.set(balanceKey, layers);
      continue;
    }
    const quantity = Number(entry.quantity) || 0;
    for (const [locationId, delta] of [
      [entry.sourceLocationId, -quantity],
      [entry.destinationLocationId, quantity],
    ]) {
      if (!locationId) continue;
      const balanceKey = JSON.stringify([locationId, entry.inventorySkuId]);
      const layers = remainingByLocationSkuLayer.get(balanceKey) || new Map();
      const current = layers.get(layerId) || {
        quantity: 0,
        unitCogs,
      };
      current.quantity += delta;
      layers.set(layerId, current);
      remainingByLocationSkuLayer.set(balanceKey, layers);
    }
  }

  let total = 0;
  const productsWithLedgerBalances = new Set();
  for (const balance of balances) {
    const quantityOnHand = Math.max(0, Number(balance.quantityOnHand) || 0);
    const sku = balance.inventorySku || {};
    const product = sku.product || {};
    if (sku.productId || product.id) productsWithLedgerBalances.add(sku.productId || product.id);

    const layers = [...(remainingByLocationSkuLayer.get(
      JSON.stringify([balance.locationId, balance.inventorySkuId]),
    )?.values() || [])].filter((layer) => layer.quantity > 0);
    const layerQuantity = layers.reduce((sum, layer) => sum + layer.quantity, 0);
    const scale = layerQuantity > quantityOnHand && layerQuantity > 0
      ? quantityOnHand / layerQuantity
      : 1;
    for (const layer of layers) {
      total += layer.quantity * scale * layer.unitCogs;
    }
    const uncostedQuantity = Math.max(0, quantityOnHand - Math.min(quantityOnHand, layerQuantity));
    total += uncostedQuantity * asAmount(product.costPrice);
  }

  for (const product of products) {
    if (productsWithLedgerBalances.has(product.id)) continue;
    total += asAmount(product.stockQuantity) * asAmount(product.costPrice);
  }

  return roundMoney(total);
};

export const calculateManufacturerLogisticsExpenseDetails = ({ shipments = [] } = {}) => {
  const seen = new Set();
  const details = shipments.flatMap((shipment) => {
    if (
      !shipment?.id ||
      seen.has(shipment.id) ||
      !shipment.dispatchedAt ||
      String(shipment.bookingMode || "").toUpperCase() !== "MANUAL"
    ) return [];
    seen.add(shipment.id);

    const amount = asAmount(shipment.freightCharge);
    if (!amount) return [];
    return [{
      id: shipment.id,
      date: shipment.dispatchedAt || null,
      transferId: shipment.stockTransferId || shipment.stockTransfer?.id || null,
      title: "Transportation and logistics - manufacturer to distributor",
      category: "LOCAL_MANUFACTURER_TO_DISTRIBUTOR",
      amount: roundMoney(amount),
      paidAmount: roundMoney(Math.min(amount, asAmount(shipment.freightPaidAmount))),
      outstandingAmount: roundMoney(Math.max(0, amount - Math.min(amount, asAmount(shipment.freightPaidAmount)))),
      vendorName: shipment.deliveryPartner || "Local delivery company not recorded",
      trackingNumber: shipment.trackingNumber || shipment.externalReference || null,
      manufacturerName: shipment.stockTransfer?.manufacturer?.name || null,
      distributorName: shipment.stockTransfer?.distributor?.name || null,
      paymentStatus: shipment.freightSettlementStatus || null,
      source: "Dispatched local stock-transfer shipment",
    }];
  });

  return {
    total: roundMoney(details.reduce((total, entry) => total + entry.amount, 0)),
    details,
  };
};

export const calculateFinancialDashboardProductCosts = ({
  orders = [],
  costLayers = [],
  manufacturerInventories = [],
  products = [],
} = {}) => {
  const costLayersById = normalizeProductionCostLayers(costLayers);
  const layerTotals = new Map();
  for (const layer of costLayers) {
    const normalizedLayer = layer.id ? costLayersById.get(layer.id) || layer : layer;
    addWeightedRates(
      layerTotals,
      normalizedLayer.productId,
      normalizedLayer.unitCogs,
      normalizedLayer.unitDeliveryCost,
      normalizedLayer.producedQuantity,
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
  const productCostDetails = [];
  const deliveryAndOtherOverheadDetails = [];
  const addDetail = (details, order, item, quantity, unitAmount, source, referenceId = null) => {
    const totalAmount = unitAmount * quantity;
    if (totalAmount <= 0) return;
    details.push({
      id: `${order.id || "order"}-${item.productId || item._id || item.id || "item"}-${details.length}`,
      orderId: order.id || null,
      date: order.date == null ? null : Number(order.date),
      productId: item.productId || item._id || item.id || null,
      productName: item.name || item.productName || "Product",
      size: item.size || null,
      color: item.color || null,
      quantity,
      unitAmount: Number(unitAmount.toFixed(6)),
      totalAmount,
      source,
      referenceId,
    });
  };
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
          const costLayer = costLayersById.get(allocation.costLayerId);
          const unitCogs = asAmount(costLayer?.unitCogs ?? allocation.unitCogs);
          const unitDeliveryCost = asAmount(costLayer?.unitDeliveryCost ?? allocation.unitDeliveryCost);
          directCOGS += unitCogs * allocated;
          deliveryAndOtherOverheads += unitDeliveryCost * allocated;
          const costSource = costLayer?.hasBatchOtherCost
            ? `Accepted batch unit COGS · production batch ${costLayer.productionRequestId}`
            : "Accepted production cost allocation";
          const overheadSource = costLayer?.hasBatchOtherCost
            ? `Batch transportation/other cost ÷ ${costLayer.batchGoodQuantity} good units`
            : "Accepted production cost allocation";
          addDetail(productCostDetails, order, item, allocated, unitCogs, costSource, allocation.costLayerId || null);
          addDetail(deliveryAndOtherOverheadDetails, order, item, allocated, unitDeliveryCost, overheadSource, allocation.costLayerId || null);
        }

        const legacyQuantity = Math.max(0, Number(item.legacyCostQuantity ?? (quantity - allocatedQuantity)) || 0);
        if (legacyQuantity) {
          const acceptedUnitCogs = item.legacyUnitCogsVatInclusiveAtAcceptance
            ?? item.agreedUnitCogsVatInclusiveAtAcceptance
            ?? null;
          const unitCogs = resolveUnitAmount(acceptedUnitCogs, rates.unitCogs, item.costPrice);
          const unitDeliveryCost = asAmount(item.unitDeliveryCost ?? rates.unitOverhead);
          const cogsSource = acceptedUnitCogs !== null
            ? "Accepted legacy unit COGS snapshot"
            : rates.unitCogs > 0 ? "Weighted production cost-layer rate" : "Product cost fallback";
          const overheadSource = item.unitDeliveryCost !== undefined && item.unitDeliveryCost !== null
            ? "Accepted legacy delivery/other cost snapshot"
            : rates.unitOverhead > 0 ? "Weighted production cost-layer rate (legacy fallback)" : "No recorded per-unit overhead";
          directCOGS += unitCogs * legacyQuantity;
          deliveryAndOtherOverheads += unitDeliveryCost * legacyQuantity;
          addDetail(productCostDetails, order, item, legacyQuantity, unitCogs, cogsSource);
          addDetail(deliveryAndOtherOverheadDetails, order, item, legacyQuantity, unitDeliveryCost, overheadSource);
        }
        continue;
      }

      const acceptedUnitCogs = item.legacyUnitCogsVatInclusiveAtAcceptance
        ?? item.agreedUnitCogsVatInclusiveAtAcceptance
        ?? null;
      const unitCogs = resolveUnitAmount(acceptedUnitCogs, rates.unitCogs, item.costPrice);
      const explicitOverhead = item.unitDeliveryCost ?? item.approvedDeliveryCost;
      const unitOverhead = asAmount(explicitOverhead ?? rates.unitOverhead);
      directCOGS += unitCogs * quantity;
      deliveryAndOtherOverheads += unitOverhead * quantity;
      const cogsSource = acceptedUnitCogs !== null
        ? "Accepted legacy unit COGS snapshot"
        : rates.unitCogs > 0 ? "Weighted production cost-layer rate" : "Product cost fallback";
      const overheadSource = explicitOverhead !== null && explicitOverhead !== undefined
        ? item.unitDeliveryCost !== undefined && item.unitDeliveryCost !== null
          ? "Order delivery/other cost snapshot"
          : "Approved delivery/other cost snapshot"
        : rates.unitOverhead > 0 ? "Weighted production cost-layer rate (legacy fallback)" : "No recorded per-unit overhead";
      addDetail(productCostDetails, order, item, quantity, unitCogs, cogsSource);
      addDetail(deliveryAndOtherOverheadDetails, order, item, quantity, unitOverhead, overheadSource);
    }
  }

  return {
    directCOGS: roundMoney(directCOGS),
    deliveryAndOtherOverheads: roundMoney(deliveryAndOtherOverheads),
    unitsSold,
    details: {
      productCOGS: productCostDetails,
      deliveryAndOtherOverheads: deliveryAndOtherOverheadDetails,
    },
  };
};
