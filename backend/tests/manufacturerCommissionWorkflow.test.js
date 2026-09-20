import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommissionUpdate } from '../controllers/manufacturerController.js';

test('admin can propose a rate and manufacturer can accept it', () => {
  const result = resolveCommissionUpdate({
    currentManufacturer: {
      commissionStatus: 'PENDING',
      commissionLastProposedBy: 'ADMIN',
      proposedCommissionRate: 12,
      agreedCommissionRate: null,
      commissionHistory: [],
    },
    actorRole: 'MANUFACTURER',
    body: {
      agreedCommissionRate: 12,
      commissionStatus: 'APPROVED',
    },
    now: new Date('2026-09-20T00:00:00.000Z'),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.updateData.commissionStatus, 'APPROVED');
  assert.equal(result.updateData.agreedCommissionRate, 12);
  assert.equal(result.updateData.proposedCommissionRate, 12);
});

test('admin cannot accept its own proposed rate without manufacturer counterparty', () => {
  const result = resolveCommissionUpdate({
    currentManufacturer: {
      commissionStatus: 'PENDING',
      commissionLastProposedBy: 'ADMIN',
      proposedCommissionRate: 12,
      agreedCommissionRate: null,
      commissionHistory: [],
    },
    actorRole: 'ADMIN',
    body: {
      agreedCommissionRate: 12,
      commissionStatus: 'APPROVED',
    },
    now: new Date('2026-09-20T00:00:00.000Z'),
  });

  assert.equal(result.allowed, false);
  assert.match(result.message, /manufacturer/i);
});

test('manufacturer can counter-offer after admin proposal and admin can then accept it', () => {
  const adminProposal = resolveCommissionUpdate({
    currentManufacturer: {
      commissionStatus: 'PENDING',
      commissionLastProposedBy: 'ADMIN',
      proposedCommissionRate: 12,
      agreedCommissionRate: null,
      commissionHistory: [],
    },
    actorRole: 'MANUFACTURER',
    body: {
      proposedCommissionRate: 15,
    },
    now: new Date('2026-09-20T00:00:00.000Z'),
  });

  assert.equal(adminProposal.allowed, true);
  assert.equal(adminProposal.updateData.commissionLastProposedBy, 'MANUFACTURER');

  const adminAccept = resolveCommissionUpdate({
    currentManufacturer: {
      commissionStatus: 'PENDING',
      commissionLastProposedBy: 'MANUFACTURER',
      proposedCommissionRate: 15,
      agreedCommissionRate: null,
      commissionHistory: [],
    },
    actorRole: 'ADMIN',
    body: {
      agreedCommissionRate: 15,
      commissionStatus: 'APPROVED',
    },
    now: new Date('2026-09-21T00:00:00.000Z'),
  });

  assert.equal(adminAccept.allowed, true);
  assert.equal(adminAccept.updateData.commissionStatus, 'APPROVED');
  assert.equal(adminAccept.updateData.agreedCommissionRate, 15);
});

test('finalized commission remains locked for one month', () => {
  const result = resolveCommissionUpdate({
    currentManufacturer: {
      commissionStatus: 'APPROVED',
      commissionLockUntil: new Date('2026-10-20T00:00:00.000Z'),
      agreedCommissionRate: 12,
      proposedCommissionRate: 12,
      commissionHistory: [],
    },
    actorRole: 'MANUFACTURER',
    body: {
      proposedCommissionRate: 15,
    },
    now: new Date('2026-09-20T00:00:00.000Z'),
  });

  assert.equal(result.allowed, false);
  assert.match(result.message, /locked|month/i);
});
