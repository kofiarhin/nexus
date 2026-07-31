import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hashPassword } from '../server/services/authService.js';

/**
 * Generates the value for OWNER_PASSWORD_HASH.
 *
 * The password is read interactively and never written to a file, printed
 * back, or committed. Only the derived scrypt hash is displayed.
 */
const argument = process.argv[2];

let password = argument;

if (!password) {
  const rl = createInterface({ input: stdin, output: stdout });
  password = await rl.question('Owner password: ');
  rl.close();
}

if (!password || password.length < 12) {
  console.error('Refusing to hash: use a password of at least 12 characters.');
  process.exit(1);
}

console.log('\nAdd this to your .env (never commit .env):\n');
console.log(`OWNER_PASSWORD_HASH=${hashPassword(password)}`);
console.log('\nAlso set OWNER_EMAIL to the owner sign-in address.\n');
