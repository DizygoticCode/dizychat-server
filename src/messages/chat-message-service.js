'use strict';

const mongoose = require('mongoose');
const sanitizeHtml = require('sanitize-html');
const Message = require('../models/message');

const cleanText = (value, maxLength) => sanitizeHtml(String(value || ''), {
  allowedTags: [],
  allowedAttributes: {},
}).slice(0, maxLength);

const createChatMessageService = ({ io, pushCoordinator } = {}) => {
  if (!io || !pushCoordinator) throw new TypeError('chat message service dependencies are required');

  const persistChatMessage = async ({
    room,
    username,
    senderCanonicalUsername = '',
    message = {},
  } = {}) => {
    const roomName = String(room || '').trim();
    const user = String(username || '').trim();
    if (!roomName || !user) {
      const error = new Error('MESSAGE_IDENTITY_INVALID');
      error.code = 'MESSAGE_IDENTITY_INVALID';
      throw error;
    }

    const msgData = { ...message, room: roomName, user };
    if (msgData.text?.length > 1000) msgData.text = msgData.text.substring(0, 1000);
    if (msgData.text) msgData.text = cleanText(msgData.text, 1000);

    if (msgData.fileUrl) {
      const fileUrl = String(msgData.fileUrl).trim();
      if (/^(https?:\/\/|\/)/i.test(fileUrl)) msgData.fileUrl = fileUrl;
      else delete msgData.fileUrl;
    }
    if (msgData.fileType) msgData.fileType = String(msgData.fileType).trim().slice(0, 100);
    if (msgData.fileName) msgData.fileName = cleanText(msgData.fileName, 120);

    let replyToDocId = null;
    let replySnapshot = null;
    if (msgData.replyTo) {
      const replyId = String(msgData.replyTo).trim();
      if (mongoose.Types.ObjectId.isValid(replyId)) {
        try {
          const repliedMessage = await Message.findById(replyId).lean();
          if (repliedMessage && repliedMessage.room === roomName) {
            replyToDocId = repliedMessage._id;
            replySnapshot = {
              id: String(repliedMessage._id),
              user: repliedMessage.user || 'Anon',
              text: cleanText(repliedMessage.text, 240),
              fileUrl: repliedMessage.fileUrl || '',
              fileType: repliedMessage.fileType || '',
              fileName: cleanText(repliedMessage.fileName, 120),
              deleted: Boolean(repliedMessage.deleted),
            };
          }
        } catch (error) {
          console.warn('[Message] Failed to load reply target', error);
        }
      }
    }

    if (!replyToDocId) {
      delete msgData.replyTo;
      delete msgData.replyToSnapshot;
    } else {
      msgData.replyTo = replyToDocId;
      msgData.replyToSnapshot = replySnapshot;
    }

    const newMsg = new Message({
      ...msgData,
      timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
      reactions: msgData.reactions || [],
      pinned: msgData.pinned || false,
      starredBy: msgData.starredBy || [],
    });
    await newMsg.save();
    io.to(roomName).emit('chat message', newMsg);

    try {
      if (newMsg.status !== 'delivered') {
        await Message.findByIdAndUpdate(newMsg._id, { status: 'delivered' });
        newMsg.status = 'delivered';
      }
    } catch (error) {
      console.error('[Message] Failed to update delivery status:', error);
    }
    io.to(roomName).emit('message status', { id: newMsg._id, status: 'delivered' });

    void pushCoordinator.onMessageStored(
      newMsg.toJSON ? newMsg.toJSON() : newMsg,
      { senderCanonicalUsername: String(senderCanonicalUsername || '') },
    ).catch((error) => {
      console.warn('[Push] post-message dispatch failed', { code: String(error?.code || 'unexpected') });
    });

    return newMsg;
  };

  return { persistChatMessage };
};

module.exports = { createChatMessageService };
