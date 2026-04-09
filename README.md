# szept — Encrypted Matrix Chat Client

A modern, end-to-end encrypted Matrix client with Material 3 design. Connect to any Matrix homeserver for secure, decentralized messaging with voice/video calls, link previews, and PWA support.

Built as a clean, privacy-focused alternative to Element — lightweight, fast, and installable as a desktop app.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue) ![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **End-to-end encryption** — Olm/Megolm via matrix-sdk-crypto-wasm
- **Any Matrix homeserver** — connect to matrix.org, your own Synapse/Conduit, or any compatible server
- **Material 3 design** — modern dark theme UI
- **Voice & video calls** — WebRTC-based calling
- **PWA installable** — install as a desktop/mobile app with offline support
- **Rich link previews** — automatic URL preview cards
- **Voice messages** — record and send voice notes
- **Reactions & replies** — full message interaction support
- **Security hardened** — CSP, DOMPurify HTML sanitization, SSRF protection on proxy
- **Matrix proxy** — server-side proxy with SSRF protection for homeserver communication

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A Matrix account on any homeserver (e.g., [matrix.org](https://matrix.org/))

No API keys required — Matrix is a free, open, decentralized protocol.

## Quick Start

```bash
git clone https://github.com/zlnsk/szept.git
cd szept
npm install
cp .env.example .env.local
# Optionally edit .env.local to configure trusted homeservers
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your Matrix credentials.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `TRUSTED_HOMESERVER_HOSTS` | No | Comma-separated trusted Matrix servers (default: matrix.org) |
| `ALLOWED_HOMESERVER_HOSTS` | No | Comma-separated allowed servers for proxy (default: matrix.org) |
| `PORT` | No | Server port (default: 3000) |

## Tech Stack

- **Framework:** Next.js 16, React 19, TypeScript
- **E2EE:** matrix-sdk-crypto-wasm (Olm/Megolm)
- **Styling:** Tailwind CSS
- **State:** Zustand
- **Calls:** WebRTC
- **PWA:** Service Worker with offline caching
- **Security:** CSP with nonce, DOMPurify, SSRF protection

## Architecture

- **Matrix Proxy** — all homeserver communication goes through a server-side proxy with SSRF protection (blocks private IPs, validates DNS)
- **Client-side encryption** — E2EE keys never leave the browser
- **Session management** — Matrix access tokens stored in httpOnly cookies

## License

MIT
