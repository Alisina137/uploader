import { createApp } from './app.js';
import { databasePath, host, origin, port } from './config.js';
import { openStore } from './store.js';

const store = openStore(databasePath);
if (!store.getOwner()) {
  console.error('Run pnpm run setup to create the owner account before starting Upload Hub.');
  store.close();
  process.exitCode = 1;
} else {
  const server = createApp({ store, origin });
  server.listen(port, host, () => console.log(`Upload Hub is running at ${origin}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => server.close(() => store.close()));
  }
}
