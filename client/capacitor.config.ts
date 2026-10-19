import type { CapacitorConfig } from '@capacitor/cli';

// The native app (iOS and Android) around the classic client. It runs the
// bundle in dist/ (scripts/app-build.mjs); the game data and the bridge are on
// the server at VITE_SERVER_ORIGIN (src/net/server.ts). See docs/NATIVE.md.
const config: CapacitorConfig = {
  appId: 'app.psobbweb.client',
  appName: 'PSOBB',
  webDir: 'dist',
  server: {
    // Android serves the bundle from https://localhost, so the page and the
    // server are both https (the server allows any origin to read its files).
    androidScheme: 'https',
  },
};

export default config;
