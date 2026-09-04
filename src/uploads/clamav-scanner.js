'use strict';

const scanFileWithClamAv = async () => {
  const error = new Error('ClamAV scanner not implemented');
  error.code = 'CLAMAV_NOT_IMPLEMENTED';
  throw error;
};

module.exports = {
  scanFileWithClamAv,
};
