// electron-builder configuration. Signing and notarization turn on only when their credentials are in the
// environment, so unsigned builds work everywhere:
//   macOS   CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application .p12), or CSC_NAME for a keychain identity
//           notarization: APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID,
//                         or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER
//   Windows WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK when building on Windows)
// Without a Developer ID the mac app is ad-hoc signed (Apple silicon refuses unsigned code).
const env = process.env
const has = (...keys) => keys.every((k) => !!env[k])

const macSigned = has('CSC_LINK') || has('CSC_NAME')
const notarize = macSigned && (has('APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID') || has('APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'))
const updateFeed = env.NODBOARD_UPDATE_URL || 'https://updates.invalid/nodboard'
const contactEmail = require('../../distribution.json').contactEmail || 'dwt199718@gmail.com'

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.nodboard.app',
  productName: 'nodboard',
  executableName: 'nodboard',
  copyright: 'Copyright © 2026 nodboard',
  artifactName: 'nodboard-${version}-${os}-${arch}.${ext}',
  directories: { output: 'release', buildResources: 'build/resources' },
  // the main process is bundled by scripts/build.mjs; keep the workspace root's node_modules out of the asar
  files: ['build/app/**/*', 'package.json', '!**/node_modules/**/*'],
  extraMetadata: { main: 'build/app/main.mjs' },
  asar: true,
  npmRebuild: false,
  extraResources: [
    { from: 'build/nodboard.mjs', to: 'nodboard.mjs' },
    { from: 'build/readable-copy-worker.mjs', to: 'readable-copy-worker.mjs' },
    { from: 'build/features.json', to: 'features.json' },
    { from: '../canvas/dist', to: 'ui' },
    { from: '../../skills/builtin', to: 'skills' },
    { from: '../../skills/ai-figma-canvas', to: 'agent-skill/ai-figma-canvas' },
    // the resvg native module (PNG export) for the target platform, staged by scripts/build.mjs
    { from: 'build/native/${os}-${arch}/node_modules', to: 'node_modules' },
  ],
  fileAssociations: [
    { ext: 'nodboard', name: 'nodboard board', role: 'Editor', mimeType: 'application/x-nodboard' },
    { ext: 'aifig', name: 'nodboard board', role: 'Editor', mimeType: 'application/x-nodboard' },
    { ext: 'nodboardpack', name: 'nodboard share pack', role: 'Viewer', mimeType: 'application/x-nodboardpack' },
    { ext: 'aifigpack', name: 'nodboard share pack', role: 'Viewer', mimeType: 'application/x-nodboardpack' },
  ],
  // generic feed: electron-builder writes latest*.yml next to the installers; the app sets the real URL at runtime
  publish: [{ provider: 'generic', url: updateFeed }],
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    icon: 'resources/icon.icns',
    identity: macSigned ? undefined : '-',
    hardenedRuntime: macSigned,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    notarize,
  },
  dmg: { artifactName: 'nodboard-${version}-mac-${arch}.${ext}' },
  win: {
    target: ['nsis'],
    icon: 'resources/icon.ico',
    // editing the exe (icon, version info) needs wine when cross-building from Linux/macOS
    signAndEditExecutable: env.NODBOARD_WIN_EDIT_EXE !== '0',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    artifactName: 'nodboard-${version}-win-${arch}-setup.${ext}',
  },
  linux: {
    target: ['AppImage', 'deb'],
    // <n>x<n>.png, 16–1024; all icons come from assets/brand/ via scripts/brand-icons.mjs
    icon: 'resources/icons',
    category: 'Graphics',
    executableName: 'nodboard',
    maintainer: `nodboard <${contactEmail}>`,
    synopsis: 'A local-first infinite canvas shared by you and your AI agents',
    desktop: { entry: { StartupWMClass: 'nodboard' } },
  },
  deb: { depends: ['libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0'] },
  appImage: { artifactName: 'nodboard-${version}-linux-${arch}.${ext}' },
}
