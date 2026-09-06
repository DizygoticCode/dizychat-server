'use strict';

const createNullTransport = () => ({
  async send() {
    return { skipped: true };
  },
  async sendControl() {
    return { skipped: true };
  },
});

module.exports = {
  createNullTransport,
};
