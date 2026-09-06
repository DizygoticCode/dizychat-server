'use strict';

const createReadStateCoordinator = ({
  readStateService,
  pushCoordinator,
  logger = console,
} = {}) => {
  if (!readStateService || !pushCoordinator) {
    throw new TypeError('read-state coordinator dependencies are required');
  }

  const advance = async (input = {}) => {
    const result = await readStateService.advanceCursor(input);
    if (result?.advanced === true && result.cursor) {
      void Promise.resolve()
        .then(() => pushCoordinator.sendRoomClear({
          canonicalUsername: input.canonicalUsername,
          room: input.room,
          cursor: result.cursor,
        }))
        .catch((error) => {
          logger.warn?.('[Push] read-control dispatch failed', {
            code: String(error?.code || 'unexpected'),
          });
        });
    }
    return result;
  };

  return {
    advance,
    getCursor: (identity) => readStateService.getCursor(identity),
  };
};

module.exports = {
  createReadStateCoordinator,
};
