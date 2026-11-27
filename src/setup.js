import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { hashPassword } from './auth.js';
import { databasePath } from './config.js';
import { openStore } from './store.js';
import { validateProfile } from './validation.js';

async function promptOwner() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run pnpm run setup in an interactive terminal.');

  let hideInput = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (hideInput) done();
      else stdout.write(chunk, encoding, done);
    }
  });
  const terminal = createInterface({ input: stdin, output, terminal: true, historySize: 0 });
  const cancelled = new AbortController();
  terminal.on('SIGINT', () => cancelled.abort());
  const ask = (label) => terminal.question(label, { signal: cancelled.signal });
  async function askPassword(label) {
    stdout.write(label);
    hideInput = true;
    try {
      return await ask('');
    } finally {
      hideInput = false;
      stdout.write('\n');
    }
  }

  try {
    const name = (await ask('Owner name: ')).trim();
    const email = (await ask('Owner email: ')).trim().toLowerCase();
    const errors = Object.values(validateProfile(name, email));
    if (errors.length) throw new Error(errors.join(' '));
    const password = await askPassword('Password (12–256 characters): ');
    if (password.length < 12 || password.length > 256) {
      throw new Error('Enter a password between 12 and 256 characters.');
    }
    const confirmation = await askPassword('Confirm password: ');
    if (password !== confirmation) throw new Error('The passwords did not match.');
    return { name, email, passwordHash: await hashPassword(password) };
  } finally {
    terminal.close();
  }
}

const store = openStore(databasePath);
try {
  if (store.getOwner()) {
    console.log('The owner account already exists.');
  } else {
    const owner = await promptOwner();
    console.log(store.createOwner(owner) ? 'Owner account created.' : 'The owner account already exists.');
  }
} catch (error) {
  console.error(error.name === 'AbortError' ? 'Setup cancelled.' : error.message);
  process.exitCode = 1;
} finally {
  store.close();
}
