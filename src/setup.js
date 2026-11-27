import { withTerminal } from './terminal.js';
import { hashPassword } from './auth.js';
import { databasePath } from './config.js';
import { openStore } from './store.js';
import { validateProfile } from './validation.js';

async function promptOwner() {
  return withTerminal(async (ask, askPassword) => {
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
  });
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
