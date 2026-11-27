import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export const databasePath = process.env.UPLOAD_HUB_DATABASE || resolve('data/upload-hub.sqlite');
export const port = Number(process.env.PORT || '3000');
export const host = process.env.HOST || '127.0.0.1';
export const origin = new URL(process.env.APP_ORIGIN || `http://localhost:${port}`).origin;
