import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { withTerminal } from './terminal.js';
import './config.js';

try {
  await withTerminal(async (ask, secretPrompt) => {
    const additions = [];
    if (!process.env.AYRSHARE_API_KEY) {
      const key = (await secretPrompt('Ayrshare API key (hidden): ')).trim();
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('Enter a valid Ayrshare API key.');
      additions.push('AYRSHARE_API_KEY=' + key);
    }
    if (!process.env.PUBLIC_MEDIA_ORIGIN) {
      const address = new URL((await ask('Public HTTPS origin serving Upload Hub media: ')).trim());
      if (address.protocol !== 'https:' || address.username || address.password || address.pathname !== '/' ||
          address.search || address.hash) throw new Error('Enter the HTTPS origin of your deployment or tunnel.');
      additions.push('PUBLIC_MEDIA_ORIGIN=' + address.origin);
    }
    if (!process.env.PUBLISH_SECRET) additions.push('PUBLISH_SECRET=' + randomBytes(32).toString('base64'));
    else if (Buffer.from(process.env.PUBLISH_SECRET, 'base64').length !== 32) throw new Error('Correct PUBLISH_SECRET in the server environment.');
    if (additions.length) appendFileSync('.env','\n'+additions.join('\n')+'\n',{mode:0o600});
    console.log('Publishing configuration ready. Restart Upload Hub to use it.');
  });
} catch (error) {
  console.error(error.name === 'AbortError' ? 'Setup cancelled.' : error.message);
  process.exitCode = 1;
}
