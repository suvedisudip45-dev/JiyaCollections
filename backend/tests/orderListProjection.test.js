import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOrderListItem } from '../controllers/orderController.js';

test('buildOrderListItem preserves required order list fields while removing unnecessary internal values', () => {
  const order = {
    id: 'ord_1',
    userId: 'user_1',
    items: [{ productId: 'p1', size: 'M', color: 'Black', quantity: 1, name: 'Tshirt' }],
    amount: 1200,
    deliveryFee: 50,
    address: { city: 'Kathmandu', street: 'Bhaktapur' },
    status: 'Order Placed',
    paymentMethod: 'COD',
    payment: false,
    date: 1720000000000,
    loyaltyDiscount: 0,
    rewardApplied: { title: 'VIP' },
    fulfillmentStatus: 'PENDING_ASSIGNMENT',
    assignmentId: 'assign_1',
    deliveryJobId: 'job_1',
    orderType: 'ONLINE_STORE',
    directOrderType: null,
    manufacturerId: 'm1',
    directNotes: null,
    deliveryOrder: {
      id: 'd1',
      ncmOrderId: 'N123',
      state: 'SUBMITTED',
      ncmStatus: 'CREATED',
      vendorReference: 'V1',
      originBranchName: 'A',
      destinationBranchName: 'B',
      pickedUpAt: null,
      deliveredAt: null,
    },
    __internal: 'remove-me',
  };

  const result = buildOrderListItem(order);

  assert.equal(result.id, 'ord_1');
  assert.equal(result.amount, 1200);
  assert.equal(result.items[0].name, 'Tshirt');
  assert.equal(result.deliveryOrder.ncmOrderId, 'N123');
  assert.equal(result.__internal, undefined);
  assert.equal(result.delivery, result.deliveryOrder);
});
