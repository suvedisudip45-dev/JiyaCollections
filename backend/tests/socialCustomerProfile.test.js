import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSocialCustomerCode,
  normalizePhoneNumber,
  sanitizePhoneNumber,
  isValidMobileNumber,
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

test('sanitizePhoneNumber strips malicious characters before validation', () => {
  assert.equal(sanitizePhoneNumber('+977 980-123-4567<script>alert(1)</script>'), '');
  assert.equal(sanitizePhoneNumber('98A1234567'), '');
  assert.equal(sanitizePhoneNumber('980123456789'), '');
  assert.equal(sanitizePhoneNumber('9801234567'), '9801234567');
});

test('isValidMobileNumber enforces Nepal mobile rules', () => {
  assert.equal(isValidMobileNumber('9801234567'), true);
  assert.equal(isValidMobileNumber('9701234567'), true);
  assert.equal(isValidMobileNumber('980123456'), false);
  assert.equal(isValidMobileNumber('9601234567'), false);
  assert.equal(isValidMobileNumber('98A1234567'), false);
  assert.equal(isValidMobileNumber('98012345678'), false);
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
