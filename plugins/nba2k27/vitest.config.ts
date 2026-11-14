import { defineConfig } from 'vitest/config';
import path from 'node:path';
const sdk = path.resolve(process.env.ACCESSRELAY_SDK_ROOT || '../../../AccessRelayStudio-Source');
const host = path.join(sdk, 'src/AccessRelayStudio/DesktopUi');
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'], alias: { '@studio': path.join(host, 'src'), react: path.join(host, 'node_modules/react'), 'react-dom': path.join(host, 'node_modules/react-dom'), '@testing-library/react': path.join(host, 'node_modules/@testing-library/react') } },
  server: { fs: { allow: [sdk, path.resolve('.')] } },
  test: { environment: 'jsdom', setupFiles: ['./tests/ui/setup.ts'], include: ['tests/ui/*.test.tsx'], clearMocks: true }
});
