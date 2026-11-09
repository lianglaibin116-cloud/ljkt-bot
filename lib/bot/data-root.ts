import { resolve } from 'node:path';

/** Packaged app bytes are read-only; user-created data lives outside the app. */
export function botDataRoot(): string {
  return process.env.LJKT_BOT_DATA_DIR?.trim()
    ? resolve(process.env.LJKT_BOT_DATA_DIR)
    : resolve(process.cwd(), 'data');
}
