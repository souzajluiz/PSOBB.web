// Prints an ADMIN_PASSWORD_HASH value (scrypt) for the admin panel.
//   printf '%s' 'my long password' | node bridge/admin-hash.mjs
// The password is read from stdin so it does not end up in the shell history
// or the process list.
import { hashPassword } from './admin.mjs';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, '');
if (password.length < 12) {
  console.error('use a password of at least 12 characters');
  process.exit(1);
}
console.log(await hashPassword(password));
