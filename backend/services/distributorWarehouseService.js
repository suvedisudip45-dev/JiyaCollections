import crypto from "node:crypto";

export const fail = (message, code = "INVALID_WAREHOUSE_REQUEST", statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const clean = (value, maxLength = 191) => {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw fail(`Value cannot exceed ${maxLength} characters.`);
  return text;
};

const positiveQuantity = (value) => {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw fail("Quantity must be a positive whole number.");
  }
  return quantity;
};

const operationKey = (value) => {
  const operation = String(value || "").trim().toUpperCase();
  if (!["RECEIVE", "PICK", "PACK", "CYCLE_COUNT"].includes(operation)) {
    throw fail("Scan operation must be RECEIVE, PICK, PACK, or CYCLE_COUNT.");
  }
  return operation;
};

export const normalizePrePackInput = (body = {}) => {
  const name = clean(body.name, 191);
  if (!name) throw fail("Pre-pack name is required.");
  const description = clean(body.description || "", 4000);
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) {
    throw fail("A pre-pack must contain between 1 and 100 SKU lines.");
  }
  const seen = new Set();
  const lines = body.lines.map((line) => {
    const inventorySkuId = clean(line?.inventorySkuId);
    if (!inventorySkuId || seen.has(inventorySkuId)) {
      throw fail("Each pre-pack line must use a unique valid inventory SKU.");
    }
    seen.add(inventorySkuId);
    return { inventorySkuId, quantity: positiveQuantity(line.quantity) };
  });
  return { name, description: description || null, lines };
};

export const normalizeWarehouseScanInput = (body = {}) => {
  const scanCode = clean(body.scanCode);
  if (!scanCode) throw fail("Scan code is required.");
  const operation = operationKey(body.operation);
  const quantity = positiveQuantity(body.quantity ?? 1);
  const referenceType = clean(body.referenceType || "", 64);
  const referenceId = clean(body.referenceId || "", 191);
  const expectedInventorySkuId = clean(body.expectedInventorySkuId || "");
  return {
    scanCode,
    operation,
    quantity,
    referenceType: referenceType || null,
    referenceId: referenceId || null,
    expectedInventorySkuId: expectedInventorySkuId || null,
  };
};

export const normalizeCycleCountInput = (body = {}) => {
  const countCode = clean(body.countCode || `CC-${Date.now().toString(36).toUpperCase()}`, 64);
  const notes = clean(body.notes || "", 4000);
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 500) {
    throw fail("A cycle count must contain between 1 and 500 SKU lines.");
  }
  const seen = new Set();
  const lines = body.lines.map((line) => {
    const inventorySkuId = clean(line?.inventorySkuId);
    if (!inventorySkuId || seen.has(inventorySkuId)) {
      throw fail("Each cycle-count line must use a unique valid inventory SKU.");
    }
    seen.add(inventorySkuId);
    const countedQuantity = Number(line.countedQuantity);
    if (!Number.isSafeInteger(countedQuantity) || countedQuantity < 0 || countedQuantity > 2147483647) {
      throw fail("Counted quantity must be a non-negative whole number.");
    }
    return {
      inventorySkuId,
      countedQuantity,
      note: clean(line.note || "", 1000) || null,
    };
  });
  return { countCode, notes: notes || null, lines };
};

export const resolveDistributorBarcode = async ({ tx, distributorId, code }) => {
  const scanCode = clean(code);
  if (!scanCode) throw fail("Barcode or QR code is required.");
  const sku = await tx.inventorySku.findFirst({
    where: {
      isActive: true,
      OR: [{ id: scanCode }, { skuCode: scanCode }],
    },
    include: {
      product: { select: { id: true, name: true, image: true, price: true } },
      balances: {
        where: { location: { kind: "DISTRIBUTOR", distributorId, isActive: true } },
        select: { quantityOnHand: true, reservedQuantity: true },
      },
    },
  });
  if (!sku) throw fail("Barcode or QR code does not match an active SKU.", "BARCODE_NOT_FOUND", 404);
  const balance = sku.balances[0];
  const quantity = balance ? Math.max(0, Number(balance.quantityOnHand) - Number(balance.reservedQuantity)) : 0;
  return {
    inventorySkuId: sku.id,
    skuCode: sku.skuCode,
    productId: sku.productId,
    productName: sku.product.name,
    image: sku.product.image,
    price: sku.product.price,
    size: sku.size,
    color: sku.color,
    availableQuantity: quantity,
  };
};

export const barcodeScanIdempotencyKey = ({ distributorId, operation, scanCode, referenceId, actorId }) =>
  crypto.createHash("sha256").update(JSON.stringify({
    distributorId,
    operation,
    scanCode,
    referenceId: referenceId || "",
    actorId: actorId || "",
  })).digest("hex");
