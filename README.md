# Messages

The best-looking Material 3 inspired Matrix client — secure, encrypted, and built from scratch.

After searching for a Matrix client that was both beautiful and truly secure, and never finding one that met the bar, I built my own. Messages is the result of hard work together with [Claude Code](https://claude.ai/code) and the patience of my wife.

## Features

- **Material 3 design** — Clean, modern UI inspired by Material You with dark-first theming
- **End-to-end encryption** — Full E2EE powered by `matrix-sdk-crypto-wasm`
- **Voice/video calls** — WebRTC-based VoIP through Matrix
- **PWA** — Installable on mobile and desktop with offline support via service worker
- **Link previews** — Rich URL previews inline in chat
- **Voice messages** — Record and send audio with WebM→OGG conversion
- **Room directory** — Browse and join public rooms
- **Security hardened** — CSP headers, DOMPurify sanitization, COOP/COEP isolation

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (standalone output) |
| UI | React 19, Tailwind CSS 4, Lucide icons |
| Design | Material 3 inspired, dark theme |
| State | Zustand |
| Protocol | matrix-js-sdk, matrix-sdk-crypto-wasm |
| Security | CSP headers, DOMPurify, COOP/COEP |

## Getting Started

```bash
npm install
npm run dev
```

Set your Matrix homeserver in the login screen — no `.env` file required.

## Build

```bash
npm run build
npm start
```

Produces a standalone Node.js server. The build version is derived automatically from `package.json` version + git SHA, or override with `BUILD_VERSION` env var.

## Project Structure

```
src/
├── app/            # Next.js app router (pages, API routes, layout)
├── components/
│   ├── chat/       # Chat UI (messages, input, sidebar, calls, settings)
│   ├── providers/  # Auth, realtime sync, theme providers
│   └── ui/         # Shared UI components (avatar, error boundary)
├── lib/
│   ├── matrix/     # Matrix client, media handling, VoIP
│   └── audio/      # WebM→OGG audio conversion
└── stores/         # Zustand stores (auth, chat, call state)
```

## License

[MIT](LICENSE)
