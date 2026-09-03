'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasRole,
  requireModerator,
  requireOwner,
} = require('../../src/auth/authorization');

const principal = (role, kind = 'account') => ({
  kind,
  username: role === 'owner' ? 'Dizygotic' : role === 'admin' ? 'Psybin' : 'Someone',
  canonicalUsername: role === 'owner' ? 'dizygotic' : role === 'admin' ? 'psybin' : 'someone',
  role,
});

test('hasRole accepts only registered account principals with an allowed role', () => {
  assert.equal(hasRole(principal('owner'), 'owner', 'admin'), true);
  assert.equal(hasRole(principal('admin'), 'owner', 'admin'), true);
  assert.equal(hasRole(principal('user'), 'owner', 'admin'), false);
  assert.equal(hasRole(principal('admin', 'guest'), 'owner', 'admin'), false);
  assert.equal(hasRole(null, 'owner'), false);
});

test('requireModerator allows owner and admin but rejects user and guest principals', () => {
  const owner = principal('owner');
  const admin = principal('admin');
  assert.equal(requireModerator({ principal: owner }), owner);
  assert.equal(requireModerator({ principal: admin }), admin);
  assert.equal(requireModerator({ principal: principal('user') }), null);
  assert.equal(requireModerator({ principal: principal('guest', 'guest') }), null);
});

test('requireOwner allows only the protected owner role', () => {
  const owner = principal('owner');
  assert.equal(requireOwner({ principal: owner }), owner);
  assert.equal(requireOwner({ principal: principal('admin') }), null);
  assert.equal(requireOwner({ principal: principal('user') }), null);
});

test('legacy client or socket flags cannot elevate a non-account principal', () => {
  const fakeElevatedGuest = {
    isAdmin: true,
    role: 'owner',
    principal: principal('guest', 'guest'),
  };
  const fakeElevatedAnonymous = { isAdmin: true, role: 'owner', principal: null };

  assert.equal(requireModerator(fakeElevatedGuest), null);
  assert.equal(requireOwner(fakeElevatedGuest), null);
  assert.equal(requireModerator(fakeElevatedAnonymous), null);
  assert.equal(requireOwner(fakeElevatedAnonymous), null);
});
