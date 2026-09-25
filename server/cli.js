/**
 * Admin account tools (accounts live in Supabase).
 *   npm run create-admin -- you@example.com "Sanskriti"
 *   npm run reset-password -- you@example.com
 * The password is typed in (hidden) or read from ADMIN_PASSWORD.
 */
import readline from 'node:readline';
import { sb } from './supabase.js';
import { hashPassword, validatePassword } from './auth.js';

const [cmd, email, name = 'Sanskriti'] = process.argv.slice(2);

function ask(question) {
  if (process.env.ADMIN_PASSWORD) return Promise.resolve(process.env.ADMIN_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };   // hide typing
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

if (!email || !['create-admin', 'reset-password'].includes(cmd)) {
  console.log('Usage: npm run create-admin -- you@example.com "Name"\n       npm run reset-password -- you@example.com');
  process.exit(1);
}
const password = await ask('Password (10+ characters): ');
try { validatePassword(password); } catch (e) { console.error(e.message); process.exit(1); }

try {
  const existing = await sb.one('admins', { select: 'id', email: `ilike.${email.replace(/[%_*]/g, '')}` });
  if (cmd === 'create-admin') {
    if (existing) { console.error('That admin already exists. Use reset-password.'); process.exit(1); }
    await sb.insert('admins', { email: email.trim(), name, password_hash: hashPassword(password) }, { select: 'id' });
    console.log(`Admin ${email} created.`);
  } else {
    if (!existing) { console.error('No admin with that email.'); process.exit(1); }
    await sb.update('admins', { id: `eq.${existing.id}` }, { password_hash: hashPassword(password) });
    await sb.remove('sessions', { admin_id: `eq.${existing.id}` });
    console.log('Password updated. Existing sessions were signed out.');
  }
} catch (e) { console.error(e.message); process.exit(1); }
