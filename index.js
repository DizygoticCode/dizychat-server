'use strict';

// Keep the long-lived DizyChat server core byte-for-byte stable while this
// entrypoint wires the small public-auth boundary around its existing app and
// session authorities.
const http = require('http');
const User = require('./src/models/user');
const accountServiceModule = require('./src/auth/account-service');
const sessionStoreModule = require('./src/auth/session-store');
const mobileSessionServiceModule = require('./src/auth/mobile-session-service');
const { createResendPasswordResetMailer } = require('./src/auth/resend-password-reset-mailer');
const { createPasswordResetService } = require('./src/auth/password-reset-service');
const { createPublicAuthRouter } = require('./src/auth/public-auth-router');

const nodeFetchModulePromise = import('node-fetch');
const fetch = (...args) =>
  nodeFetchModulePromise.then(({ default: fetchImpl }) => fetchImpl(...args));

let app = null;
let accountService = null;
let accountSessions = null;
let mobileAccountSessions = null;

const originalCreateServer = http.createServer;
const originalCreateAccountService = accountServiceModule.createAccountService;
const originalCreateSessionStore = sessionStoreModule.createSessionStore;
const originalCreateMobileSessionService = mobileSessionServiceModule.createMobileSessionService;

http.createServer = function captureDizyChatApp(requestListener, ...args) {
  if (!app && typeof requestListener === 'function') app = requestListener;
  return originalCreateServer.call(this, requestListener, ...args);
};

accountServiceModule.createAccountService = (...args) => {
  const service = originalCreateAccountService(...args);
  if (!accountService) accountService = service;
  return service;
};

sessionStoreModule.createSessionStore = (...args) => {
  const store = originalCreateSessionStore(...args);
  if (!accountSessions) accountSessions = store;
  return store;
};

mobileSessionServiceModule.createMobileSessionService = (...args) => {
  const service = originalCreateMobileSessionService(...args);
  if (!mobileAccountSessions) mobileAccountSessions = service;
  return service;
};

try {
  require('./server-core');
} finally {
  http.createServer = originalCreateServer;
  accountServiceModule.createAccountService = originalCreateAccountService;
  sessionStoreModule.createSessionStore = originalCreateSessionStore;
  mobileSessionServiceModule.createMobileSessionService = originalCreateMobileSessionService;
}

if (!app || !accountService || !accountSessions || !mobileAccountSessions) {
  throw new Error('DizyChat public auth bootstrap could not capture the existing server authorities.');
}

const passwordResetMailer = {
  sendPasswordReset: async (payload) => {
    const mailer = createResendPasswordResetMailer({
      fetchImpl: fetch,
      apiKey: process.env.DIZYCHAT_RESEND_API_KEY,
      from: process.env.DIZYCHAT_MAIL_FROM,
      replyTo: process.env.DIZYCHAT_MAIL_REPLY_TO,
      publicBaseUrl: process.env.DIZYCHAT_PUBLIC_BASE_URL,
    });
    return mailer.sendPasswordReset(payload);
  },
};

const passwordResetService = createPasswordResetService({
  UserModel: User,
  mailer: passwordResetMailer,
  sessionStore: accountSessions,
  mobileSessionService: mobileAccountSessions,
});

app.use('/api/auth', createPublicAuthRouter({
  accountService,
  passwordResetService,
}));
