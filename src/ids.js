'use strict';

const crypto = require('node:crypto');

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomString(length, alphabet) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

/** newId('evt') e newId('evt_') -> 'evt_' + 10 caracteres [a-z0-9]. */
function newId(prefix) {
  const p = String(prefix).endsWith('_') ? String(prefix) : `${prefix}_`;
  return p + randomString(10, ID_ALPHABET);
}

module.exports = { randomString, newId, ID_ALPHABET, CODE_ALPHABET };
