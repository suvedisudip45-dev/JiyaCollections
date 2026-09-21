import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSocialCustomerCode,
  normalizePhoneNumber,
  buildInactiveSocialProfile,
} from '../utils/socialCustomerProfile.js';

test('generateSocialCustomerCode creates an 8-character uppercase code', () => {
  const code = generateSocialCustomerCode();
  assert.equal(code.length, 8);
  assert.match(code, /^[A-Z0-9]{8}$/);
});

test('normalizePhoneNumber strips formatting to a clean identifier', () => {
  assert.equal(normalizePhoneNumber('+977 980-123-4567'), '9801234567');
  assert.equal(normalizePhoneNumber('9801234567'), '9801234567');
});

test('buildInactiveSocialProfile stores social-media customer metadata for later activation', () => {
  const profile = buildInactiveSocialProfile({
    firstName: 'Asha',
    lastName: 'Sharma',
    phone: '9801234567',
    gender: 'FEMALE',
    address: {
      city: 'Kathmandu',
      district: 'Bagmati',
    },
    source: 'Instagram',
    loyaltyTier: 'Silver VIP',
    orderId: 'abc-123',
  });

  assert.equal(profile.isInactiveProfile, true);
  assert.equal(profile.phone, '9801234567');
  assert.equal(profile.gender, 'FEMALE');
  assert.equal(profile.loyaltyTier, 'Silver VIP');
  assert.equal(profile.inactiveProfileData.source, 'Instagram');
  assert.match(profile.socialCustomerCode, /^[A-Z0-9]{8}$/);
});
