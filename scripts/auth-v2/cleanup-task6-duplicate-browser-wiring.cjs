'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../../public/chat.js');
let source = fs.readFileSync(target, 'utf8');

const accountJoinAnchor = 'function joinCurrentRoomAsAccount(room, password) {';
const registeredJoinAnchor = 'function emitRegisteredJoinRequest() {';
const guestJoinAnchor = 'function emitJoinRequest() {';

const countOccurrences = (text, token) => {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(token, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + token.length;
  }
};

const accountJoinCount = countOccurrences(source, accountJoinAnchor);
const registeredJoinCount = countOccurrences(source, registeredJoinAnchor);

if (accountJoinCount === 1 && registeredJoinCount === 1) {
  console.log('Task 6 browser account join wiring already unique.');
  process.exit(0);
}

if (accountJoinCount < 1 || registeredJoinCount < 1 || accountJoinCount !== registeredJoinCount) {
  throw new Error(
    `Unexpected Task 6 browser wiring counts: account=${accountJoinCount}, registered=${registeredJoinCount}`
  );
}

const firstAccountJoin = source.indexOf(accountJoinAnchor);
const duplicateAccountJoin = source.indexOf(accountJoinAnchor, firstAccountJoin + accountJoinAnchor.length);
const guestJoin = source.indexOf(guestJoinAnchor, duplicateAccountJoin);

if (firstAccountJoin === -1 || duplicateAccountJoin === -1 || guestJoin === -1) {
  throw new Error('Task 6 duplicate browser wiring seam not found');
}

const duplicateRegion = source.slice(duplicateAccountJoin, guestJoin);
if (!duplicateRegion.includes(registeredJoinAnchor)) {
  throw new Error('Task 6 duplicate region did not contain registered join wiring');
}

source = `${source.slice(0, duplicateAccountJoin)}${source.slice(guestJoin)}`;

const finalAccountCount = countOccurrences(source, accountJoinAnchor);
const finalRegisteredCount = countOccurrences(source, registeredJoinAnchor);
if (finalAccountCount !== 1 || finalRegisteredCount !== 1) {
  throw new Error(
    `Task 6 dedupe failed: account=${finalAccountCount}, registered=${finalRegisteredCount}`
  );
}

fs.writeFileSync(target, source);
console.log('Collapsed duplicate Auth v2 browser account join wiring to one canonical copy.');
