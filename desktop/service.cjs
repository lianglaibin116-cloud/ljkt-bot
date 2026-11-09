const fs = require('node:fs');
const path = require('node:path');

const appDir = process.env.LJKT_BOT_APP_DIR;
if (!appDir || !path.isAbsolute(appDir)) throw new Error('Missing isolated application directory');
process.chdir(appDir);
const isDev = process.env.LJKT_BOT_DESKTOP_DEV === '1';
process.env.NODE_ENV = isDev ? 'development' : 'production';
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.NEXT_PUBLIC_TEACHER_WORKSPACE_ENABLED = '1';
process.env.OPENMAIC_LOCAL_ACCEPTANCE = '1';
let config;
if (!isDev) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(appDir, '.next', 'required-server-files.json'), 'utf8'),
  );
  config = {
    ...manifest.config,
    distDir: '.next',
    // No image optimization cache is written into the signed application bundle.
    images: { ...manifest.config.images, unoptimized: true },
  };
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
}
require(require.resolve('next', { paths: [appDir] }));
const { startServer } = require(
  require.resolve('next/dist/server/lib/start-server', { paths: [appDir] }),
);
startServer({
  dir: appDir,
  isDev,
  config,
  hostname: '127.0.0.1',
  port: Number(process.env.PORT),
  allowRetry: false,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
