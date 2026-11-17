import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPublicLoyaltySummary, calculateUserLoyalty } from '../controllers/loyaltyController.js';
import { prisma } from '../config/db.js';
import { withOrderPricingSnapshot } from '../services/checkoutPricingService.js';

test('buildPublicLoyaltySummary keeps customer-visible values and strips sensitive/internal fields', () => {
  const summary = buildPublicLoyaltySummary({
    totalSpend: 1110,
    totalOrders: 1,
    currentLevel: {
      id: 'lvl-1',
      levelNumber: 1,
      name: 'Bronze Explorer',
      badgeIcon: '🥉',
      color: '#CD7F32',
      minSpend: 0,
      minOrders: 0,
      rewardTitle: 'Entry Level',
      rewardDescription: 'Welcome',
      freeShipping: false,
      discountAmount: 0,
      giftAmount: 0,
      giftDescription: '',
      letterIncluded: false,
      customPerk: '',
      rewardOrderLimit: 1,
      createdAt: 'internal',
      updatedAt: 'internal',
    },
    nextLevel: {
      id: 'lvl-2',
      levelNumber: 2,
      name: 'Silver VIP',
      badgeIcon: '🥈',
      color: '#94A3B8',
      minSpend: 3000,
      minOrders: 2,
      rewardTitle: 'Rs. 100 Off',
      rewardDescription: 'Upgrade',
      freeShipping: false,
      discountAmount: 100,
      giftAmount: 0,
      giftDescription: '',
      letterIncluded: true,
      customPerk: '',
      rewardOrderLimit: 3,
      createdAt: 'internal',
      updatedAt: 'internal',
    },
    progressPercentage: 44,
    remainingSpend: 1890,
    remainingOrders: 1,
    activeReward: {
      freeShipping: false,
      discountAmount: 0,
      giftAmount: 0,
      title: 'Entry Level',
      description: 'Welcome',
      orderLimit: 1,
      remainingUses: 0,
      perkTags: ['No perks'],
      isEligible: false,
    },
    allLevels: [
      {
        id: 'lvl-1',
        levelNumber: 1,
        name: 'Bronze Explorer',
        badgeIcon: '🥉',
        color: '#CD7F32',
        minSpend: 0,
        minOrders: 0,
        rewardTitle: 'Entry Level',
        rewardDescription: 'Welcome',
        createdAt: 'internal',
      },
      {
        id: 'lvl-2',
        levelNumber: 2,
        name: 'Silver VIP',
        badgeIcon: '🥈',
        color: '#94A3B8',
        minSpend: 3000,
        minOrders: 2,
        rewardTitle: 'Rs. 100 Off',
        rewardDescription: 'Upgrade',
        createdAt: 'internal',
      },
    ],
  });

  assert.equal(summary.currentLevel.name, 'Bronze Explorer');
  assert.equal(summary.nextLevel.name, 'Silver VIP');
  assert.equal(summary.allLevels.length, 2);
  assert.equal(summary.currentLevel.createdAt, undefined);
  assert.equal(summary.nextLevel.createdAt, undefined);
  assert.equal(summary.allLevels[0].createdAt, undefined);
  assert.equal(summary.activeReward.isEligible, false);
});

test('loyalty tier spend uses the accepted decimal order snapshot', async (t) => {
  const originalCount = prisma.customerLevel.count;
  const originalFindLevels = prisma.customerLevel.findMany;
  const originalFindOrders = prisma.order.findMany;
  prisma.customerLevel.count = async () => 1;
  prisma.customerLevel.findMany = async () => [
    { levelNumber: 1, name: 'Base', minSpend: 0, minOrders: 0, rewardOrderLimit: 1 },
    { levelNumber: 2, name: 'Threshold', minSpend: 10, minOrders: 1, rewardOrderLimit: 1 },
  ];
  prisma.order.findMany = async () => [{
    id: 'order-1',
    amount: 0,
    rewardApplied: '{}',
    locationPricingSnapshot: withOrderPricingSnapshot(null, {
      version: 2,
      currency: 'NPR',
      totals: { finalPayableTotal: '10.005', deliveryFee: '0' },
      lines: [],
    }),
  }];
  t.after(() => {
    prisma.customerLevel.count = originalCount;
    prisma.customerLevel.findMany = originalFindLevels;
    prisma.order.findMany = originalFindOrders;
  });

  const loyalty = await calculateUserLoyalty('user-1');
  assert.equal(loyalty.currentLevel.name, 'Threshold');
  assert.equal(loyalty.totalSpendDecimal, '10.005');
});
