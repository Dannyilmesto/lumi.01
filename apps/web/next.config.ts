import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Radice del monorepo: senza questo, Next.js può scegliere la cartella home
// (che contiene un altro pnpm-lock.yaml) come workspace per il file tracing.
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const nextConfig = (phase: string): NextConfig => ({
  // Keep production builds from overwriting the running development server.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  serverExternalPackages: ['playwright', 'playwright-core', 'sharp'],
  outputFileTracingRoot: workspaceRoot,
});

export default nextConfig;
