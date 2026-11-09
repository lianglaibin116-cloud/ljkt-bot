import type { NextConfig } from 'next';

const isVercelBuild = Boolean(process.env.VERCEL);
const isTeacherAcceptance = process.env.OPENMAIC_LOCAL_ACCEPTANCE === '1';

const nextConfig: NextConfig = {
  env: {
    // Keep the existing classroom chat for the teacher acceptance profile
    // unless the operator explicitly opts into the new Pi runtime.
    NEXT_PUBLIC_PI_CHAT_ENABLED:
      process.env.NEXT_PUBLIC_PI_CHAT_ENABLED ?? (isTeacherAcceptance ? 'false' : ''),
  },
  // Multiple lockfiles can make Next infer the user's home directory as the
  // Turbopack root, which breaks CSS dependency resolution on local installs.
  turbopack: {
    root: process.cwd(),
  },
  // Local acceptance runs via `next start`; container builds keep standalone.
  output:
    process.env.LJKT_BOT_DESKTOP_BUILD === '1'
      ? 'standalone'
      : isVercelBuild || isTeacherAcceptance
        ? undefined
        : 'standalone',
  // Runtime prompt loaders read Markdown through fs, so these assets cannot
  // be inferred from imports. Keep them in self-hosted standalone packages.
  outputFileTracingIncludes: {
    '/*': [
      'lib/prompts/**',
      'packages/@openmaic/generation/templates/**',
      'packages/@openmaic/generation/snippets/**',
      'lib/server/agent-runtime/import-pptx-worker.mjs',
      'skills/openmaic/**',
      'skills/agent-runtime/**',
      // Loaded through a runtime-only `import('undici')` (see the LLM
      // dispatcher in lib/ai/providers.ts and the Google proxy transport), so
      // the output tracer never sees it and standalone builds ship without it.
      'node_modules/undici/**',
      // sharp's native libvips libraries are loaded via dlopen and are not
      // statically analyzable, so Next.js standalone tracing omits them. Two
      // sharp versions resolve in the tree (0.34.5 transitive -> libvips
      // 1.2.4, 0.35.4 direct -> libvips 1.3.3); tracing picked the wrong one
      // and the runtime dlopen of sharp 0.35.4 failed with
      // "libvips-cpp.so.8.18.6: No such file or directory" on self-hosted
      // Docker (Alpine/musl) deployments. Force-include every sharp-libvips
      // native lib dir for standalone builds. Vercel packages its runtime
      // dependencies itself; including every native variant there bloats each
      // traced function and can push Hobby deployments past 12 bundles.
      ...(!isVercelBuild
        ? ['node_modules/.pnpm/@img+sharp-libvips-*/node_modules/@img/sharp-libvips-*/lib/**']
        : []),
    ],
  },
  // Keep prior desktop builds out of the tracing root. Otherwise a build can
  // recursively include desktop/build and desktop/release from the previous
  // run into its next standalone output.
  outputFileTracingExcludes: {
    '/*': ['./desktop/build/**/*', './desktop/release/**/*'],
  },
  typescript: {
    tsconfigPath: process.env.NODE_ENV === 'production' ? 'tsconfig.build.json' : 'tsconfig.json',
  },
  transpilePackages: ['mathml2omml', 'pptxgenjs', '@openmaic/importer'],
  // These agent packages do a runtime `import(specifier)` with a computed
  // specifier (to lazily load node:fs/os/path without breaking browser/Vite
  // builds). webpack can't statically analyze that and bundling it throws
  // "Cannot find module as expression is too dynamic" at runtime on the server
  // (the "Edit with AI" Pro-mode path), which broke the #619 keep-alive e2e.
  // Mark them server-external so Next loads them natively and the dynamic
  // import resolves as a real Node call.
  serverExternalPackages: [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@openmaic/generation',
    // Optional peers of @openmaic/storage, reached through deliberately
    // untraced dynamic imports. Externalizing keeps them out of the bundle,
    // and the static anchor in lib/persistence/asset-byte-store.ts gets them
    // traced into the standalone image -- without it, S3 mode and redirect
    // egress cannot resolve their SDK in the shipped deployment.
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
  experimental: {
    // Resolve named barrel exports to their actual modules before webpack
    // traverses unused Node-only siblings in the shared package entrypoints.
    // This is import optimization, not a fallback/polyfill for Node APIs.
    optimizePackageImports: ['@openmaic/storage'],
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
