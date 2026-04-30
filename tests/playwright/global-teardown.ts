import { rmSync } from 'fs';

export default async function globalTeardown(): Promise<void> {
  const userDataDir = process.env.PLAYWRIGHT_USER_DATA_DIR;
  if (!userDataDir) return;
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch (err) {
    process.stderr.write(`Failed to remove temp USER_DATA_DIR ${userDataDir}: ${err}\n`);
  }
}
