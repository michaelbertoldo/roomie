import { randomInt } from 'node:crypto';

// No 0/O/1/I so codes survive being read aloud or typed from a text message.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newJoinCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
