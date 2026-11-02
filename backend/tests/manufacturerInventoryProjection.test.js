import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../config/db.js';
import {
  buildAdminInventoryItem,
  getAllInventory,
} from '../controllers/manufacturerInventoryController.js';

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('buildAdminInventoryItem projects hub and SKU ledger balances for the monitor', () => {
  const result = buildAdminInventoryItem(
    {
      id: 'location_1:sku_1',
      productId: 'product_1',
      productName: 'Tshirt',
      productImage: ['shirt.jpg'],
      productPrice: 1200,
      productCategory: 'Topwear',
      quantity: 15n,
      reservedQty: 2n,
      inventorySkuId: 'sku_1',
      skuCode: 'TEE-M-BLK',
      size: 'M',
      color: 'Black',
      hubId: 'manufacturer_1',
      hubType: 'FACTORY',
      hubName: 'Hub One',
      hubCity: 'Kathmandu',
      locationId: 'location_1',
      locationName: 'Hub One factory',
    },
  );

  assert.equal(result.id, 'location_1:sku_1');
  assert.equal(result.quantity, 15);
  assert.equal(result.reservedQty, 2);
  assert.equal(result.availableQty, 13);
  assert.deepEqual(result.hub, {
    id: 'manufacturer_1',
    type: 'FACTORY',
    name: 'Hub One',
    city: 'Kathmandu',
    locationId: 'location_1',
    locationName: 'Hub One factory',
  });
  assert.deepEqual(result.sku, { id: 'sku_1', size: 'M', color: 'Black', code: 'TEE-M-BLK' });
  assert.equal(result.product.price, 1200);
});

test('buildAdminInventoryItem does not report negative available stock for inconsistent balances', () => {
  const result = buildAdminInventoryItem(
    {
      id: 'location_2:sku_2',
      productId: 'deleted_product',
      productName: 'Archived product',
      productImage: [],
      productPrice: 100,
      productCategory: 'Topwear',
      quantity: 2,
      reservedQty: 5,
      inventorySkuId: 'sku_2',
      size: 'Standard',
      color: 'Standard',
      hubId: 'distributor_2',
      hubType: 'DISTRIBUTOR',
      hubName: 'Hub Two',
      locationId: 'location_2',
      locationName: 'Hub Two stock',
    },
  );

  assert.equal(result.product.name, 'Archived product');
  assert.equal(result.availableQty, 0);
});

test('getAllInventory returns per-SKU ledger rows for manufacturer and distributor hubs', async (t) => {
  stubMethod(t, prisma, '$queryRaw', async (query) => {
    assert.match(query.sql, /InventoryBalance/);
    assert.match(query.sql, /InventoryLocation/);
    assert.match(query.sql, /InventorySku/);
    assert.match(query.sql, /DISTRIBUTOR/);
    assert.match(query.sql, /FACTORY/);
    assert.doesNotMatch(query.sql, /ManufacturerInventory/);
    return [
      {
        productId: 'product_1',
        inventorySkuId: 'sku_factory',
        skuCode: 'TEE-M-BLK',
        size: 'M',
        color: 'Black',
        locationId: 'location_factory',
        locationName: 'Factory',
        hubType: 'FACTORY',
        hubId: 'manufacturer_1',
        hubName: 'Factory One',
        hubCity: 'Kathmandu',
        quantity: 15n,
        reservedQty: 4n,
      },
      {
        productId: 'product_1',
        inventorySkuId: 'sku_distributor',
        skuCode: 'TEE-M-BLK',
        size: 'M',
        color: 'Black',
        locationId: 'location_distributor',
        locationName: 'Distributor stock',
        hubType: 'DISTRIBUTOR',
        hubId: 'distributor_1',
        hubName: 'Distributor One',
        hubCity: 'Lalitpur',
        quantity: 6n,
        reservedQty: 1n,
      },
    ];
  });
  stubMethod(t, prisma.product, 'findMany', async () => [{
    id: 'product_1',
    name: 'Tshirt',
    image: ['shirt.jpg'],
    price: 1200,
    category: 'Topwear',
  }]);

  const response = createResponse();
  await getAllInventory({}, response);

  assert.equal(response.body.success, true);
  assert.equal(response.body.inventory.length, 2);
  const factoryStock = response.body.inventory.find(({ hub }) => hub.type === 'FACTORY');
  const distributorStock = response.body.inventory.find(({ hub }) => hub.type === 'DISTRIBUTOR');
  assert.equal(factoryStock.quantity, 15);
  assert.equal(factoryStock.reservedQty, 4);
  assert.equal(factoryStock.availableQty, 11);
  assert.equal(factoryStock.sku.size, 'M');
  assert.equal(distributorStock.quantity, 6);
  assert.equal(distributorStock.reservedQty, 1);
  assert.equal(distributorStock.availableQty, 5);
  assert.equal(distributorStock.hub.name, 'Distributor One');
});
