import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdminInventoryItem } from '../controllers/manufacturerInventoryController.js';

test('buildAdminInventoryItem keeps monitor fields and strips inventory internals', () => {
  const result = buildAdminInventoryItem(
    {
      id: 'inventory_1',
      productId: 'product_1',
      productName: 'Tshirt',
      quantity: 12,
      reservedQty: 3,
      variantsStock: [{ size: 'M', quantity: 4 }],
      proposedCostPrice: 700,
      manufacturer: { id: 'manufacturer_1', name: 'Hub One', city: 'Kathmandu' },
    },
    { id: 'product_1', name: 'Tshirt', image: ['shirt.jpg'], price: 1200, category: 'Topwear' },
  );

  assert.deepEqual(result.manufacturer, {
    id: 'manufacturer_1',
    name: 'Hub One',
    city: 'Kathmandu',
    businessName: 'Hub One',
  });
  assert.equal(result.availableQty, 9);
  assert.equal(result.product.price, 1200);
  assert.equal(result.variantsStock, undefined);
  assert.equal(result.proposedCostPrice, undefined);
});

test('buildAdminInventoryItem preserves the missing-product fallback', () => {
  const result = buildAdminInventoryItem(
    {
      id: 'inventory_2',
      productId: 'deleted_product',
      productName: 'Archived product',
      quantity: 2,
      reservedQty: 5,
      manufacturer: { id: 'manufacturer_2', name: 'Hub Two', city: 'Pokhara' },
    },
    undefined,
  );

  assert.deepEqual(result.product, { id: 'deleted_product', name: 'Archived product' });
  assert.equal(result.availableQty, 0);
});
