import { run } from '@tauri-apps/cli';

// Every desktop build uses the current opaque branding asset.
await run(['icon', 'assets/opaq.png'], 'tauri');
