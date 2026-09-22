import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPublicLoyaltySummary } from '../controllers/loyaltyController.js';

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
