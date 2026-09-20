'use strict';

const createNullTransport = () => ({
  async send() {
    return { skipped: true, reason: 'fcm-disabled' };
  },
  async sendControl() {
    return { skipped: true };
  },
});

module.exports = {
  createNullTransport,
};
