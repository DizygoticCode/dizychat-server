'use strict';

function hasRole(principal, ...roles) {
  if (!principal || principal.kind !== 'account') return false;
  return roles.includes(principal.role);
}

function requireModerator(socket) {
  const principal = socket?.principal;
  return hasRole(principal, 'owner', 'admin') ? principal : null;
}

function requireOwner(socket) {
  const principal = socket?.principal;
  return hasRole(principal, 'owner') ? principal : null;
}

module.exports = {
  hasRole,
  requireModerator,
  requireOwner,
};
