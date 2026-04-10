# MatrixClient - Comprehensive Application Analysis

## Application Overview

MatrixClient is a modern, full-featured Matrix protocol chat client built with **Next.js 16.2.1**, **React 19.2.4**, **TypeScript**, and **Tailwind CSS 4**. It implements Material Design 3 (M3) styling, supports end-to-end encryption via the matrix-js-sdk Rust crypto (WASM), and provides a responsive two-pane layout with dark/light theme support. State management is handled via **Zustand** stores, and all Matrix homeserver communication is proxied through a server-side API route with SSRF protection.

---

## 10 Functionality Improvements

### 1. Offline Message Queue with Retry
**Current state:** Messages fail silently when the connection drops mid-send.
**Proposal:** Implement a persistent outbox queue (IndexedDB-backed) that stores unsent messages and automatically retries them with exponential backoff when connectivity is restored. Show a visual indicator (clock icon) on queued messages so the user knows they're pending. This eliminates the frustrating experience of typing a long message only to lose it to a network blip.

### 2. Rich Message Composer with Formatting Toolbar
**Current state:** The message input is a plain textarea. Formatting requires knowing Markdown syntax.
**Proposal:** Add an optional WYSIWYG toolbar above the textarea with buttons for **bold**, *italic*, ~~strikethrough~~, `code`, block quotes, and ordered/unordered lists. Include a toggle to switch between rich-text and raw Markdown modes. This lowers the barrier to entry for non-technical users while keeping power-user workflows intact.

### 3. Unified Search Across All Rooms
**Current state:** Search is scoped to the current conversation only; there is no global search.
**Proposal:** Add a global search mode accessible from the Command Palette (Ctrl+K) or a dedicated search tab in the sidebar. It should query the Matrix server-side search API (`/search`) across all joined rooms, return results grouped by room, and allow clicking a result to jump directly to that message in context. Include filters for sender, date range, and media type.

### 4. Message Scheduling (Send Later)
**Current state:** Messages can only be sent immediately.
**Proposal:** Add a "Schedule" option next to the send button (long-press or dropdown). Users pick a date/time, and the message is stored locally in IndexedDB with a service worker timer. When the scheduled time arrives, the service worker sends the message automatically. Show scheduled messages in a separate "Scheduled" section in the sidebar. This is especially useful for teams across time zones.

### 5. Threads Panel with Notification Badges
**Current state:** Thread replies exist but the thread panel has minimal notification support — it's easy to miss new thread activity.
**Proposal:** Add per-thread unread badges in the sidebar and a dedicated "Threads" filter view that lists all threads with unread replies across all rooms. Support "Following" threads (auto-follow threads you've participated in) and allow muting individual threads. This brings thread UX closer to Slack/Discord levels.

### 6. Voice Messages with Waveform Preview
**Current state:** The microphone button exists in the UI but voice message playback and recording UX is basic.
**Proposal:** Enhance the recording flow with a live waveform visualization during recording, a playback preview before sending (with waveform scrubbing), and duration display. Support drag-to-cancel (slide left to discard). On the receiving end, show the waveform as the audio plays with a highlighted progress indicator. Use the Web Audio API for waveform data extraction.

### 7. Room Bookmarks and Quick-Access Favorites
**Current state:** Rooms are listed chronologically by last activity. Users cannot pin favorite rooms to the top.
**Proposal:** Allow users to "star" rooms. Starred rooms appear in a collapsible "Favorites" section at the top of the sidebar, always visible regardless of scroll position. Support drag-and-drop reordering within favorites. Persist favorites using Matrix account data events (`m.favourite` tag) so they sync across devices.

### 8. Smart Notifications with Priority Levels
**Current state:** Notification settings are binary (muted or not). All unmuted rooms have equal notification weight.
**Proposal:** Implement three notification tiers: **All messages**, **Mentions & keywords only**, and **Muted**. Add a "Keywords" setting where users can define custom alert words (e.g., their name, project names). Support per-room notification sound customization. Show a notification summary grouped by room instead of one notification per message to reduce notification fatigue.

### 9. Read-Position Sync Across Devices
**Current state:** Opening a room always scrolls to the latest messages, losing the user's reading position if they were reading history on another device.
**Proposal:** Use the Matrix read-marker API (`m.fully_read`) to store the exact scroll position. When opening a room, check if the fully-read marker is behind the latest messages and offer a "Jump to where you left off" button alongside the existing "Jump to unread" pill. This creates a true cross-device reading experience.

### 10. Inline Link Previews (URL Unfurling)
**Current state:** URLs in messages are rendered as plain clickable links (with an external-link confirmation dialog).
**Proposal:** Automatically generate rich link previews for URLs. Fetch Open Graph metadata (title, description, image) server-side via the proxy (to avoid CORS/SSRF from the client) and display a compact card below the message. Support preview for common services: YouTube (embed thumbnail + duration), GitHub (repo card with stars/description), Twitter/X (tweet embed). Allow users to collapse individual previews and add a global toggle in settings.

---

## 5 Security Improvements

### 1. Migrate Session Tokens from localStorage to HttpOnly Cookies
**Current state:** The access token is stored in `localStorage` under the `matrix_session` key. While CSP mitigates XSS risk, any XSS bypass would expose the token.
**Proposal:** Move the access token to an **HttpOnly, Secure, SameSite=Strict** cookie managed by the server-side proxy. The proxy already handles all Matrix API requests, so it can inject the Authorization header from the cookie server-side. The client never needs direct JavaScript access to the token. This eliminates the most impactful XSS consequence (token theft) entirely. Keep non-sensitive session metadata (userId, deviceId, homeserverUrl) in localStorage for client-side use.

### 2. Add Content Security Policy Violation Reporting
**Current state:** The CSP is well-configured with per-request nonces, but there is no violation reporting endpoint.
**Proposal:** Implement a `/api/csp-report` endpoint that receives and logs CSP violation reports. Add the `report-uri` and `report-to` directives to the CSP header. Log violations to a structured logging service (with rate limiting on the report endpoint to prevent abuse). Monitor for patterns that indicate attempted XSS attacks or misconfigured third-party resources. This provides early warning of security incidents without any user-facing impact.

### 3. Implement Subresource Integrity (SRI) for External Resources
**Current state:** Google Fonts are loaded from `fonts.googleapis.com` and `fonts.gstatic.com`. If these CDNs are compromised, malicious CSS/fonts could be injected.
**Proposal:** Self-host the Roboto and Roboto Mono fonts (they're open source) and eliminate the external font CDN dependency entirely. This removes a third-party trust boundary, improves loading performance (no DNS lookup + connection to Google), and allows removing `https://fonts.googleapis.com` from the CSP `style-src` directive, tightening the policy. If self-hosting isn't desired, add SRI hashes to the font stylesheet `<link>` tags.

### 4. Add Device Session Management with Forced Logout
**Current state:** Users can view their devices in settings and delete individual devices with password confirmation, but there's no overview of active sessions with metadata.
**Proposal:** Enhance the device management panel to show: last active timestamp, IP address (from Matrix API), client name, and a geographic indicator. Add a "Sign out all other devices" button for emergency scenarios. Show a security alert when a new device logs into the account (via push notification or in-app banner). Add optional email/push notification for new logins. This gives users visibility and control over their account security.

### 5. Implement Rate Limiting on All API Proxy Routes
**Current state:** Rate limiting exists only on login and registration proxy routes (5 attempts per minute per IP).
**Proposal:** Extend rate limiting to cover all proxy routes with tiered limits:
- **Authentication routes** (`/login`, `/register`): 5 requests/minute (already implemented)
- **Message sending**: 30 requests/minute per user
- **Media uploads**: 10 requests/minute per user, with a daily bandwidth cap
- **Search/sync**: 60 requests/minute per user
- **Room creation/joining**: 10 requests/minute per user

Use a token-bucket algorithm backed by an in-memory store (or Redis in production) keyed by user ID (not just IP, to prevent NAT-shared limits). Return proper `Retry-After` headers. This protects both the proxy server and the upstream homeserver from abuse.

---

## 10 Design Improvements

### 1. Collapsible Sidebar with Icon-Only Mode
**Current state:** The sidebar is resizable (280px-600px) but always shows full room names and previews.
**Proposal:** Add an icon-only collapsed mode (60px wide) showing only room avatars and unread badges. Toggle with a chevron button or keyboard shortcut (Ctrl+B). In collapsed mode, hovering an avatar shows a tooltip with the room name. This maximizes chat area space on smaller screens while maintaining quick navigation. Animate the collapse/expand transition with a smooth 200ms ease-out.

### 2. Message Grouping Visual Refinement
**Current state:** Messages from the same sender are grouped, but each still shows full padding and rounded corners.
**Proposal:** Implement "bubble clustering" — consecutive messages from the same sender within a 2-minute window share a visual group: only the first bubble shows the avatar and sender name, subsequent bubbles have reduced top margin (4px instead of 8px), and the border-radius connects them visually (flat on the connecting sides, rounded on the outer edges). This creates a cleaner, more natural conversation flow similar to iMessage or WhatsApp.

### 3. Animated Presence Indicators
**Current state:** Presence is shown as a static colored dot (green/yellow/gray) on avatars.
**Proposal:** Add subtle animations: online shows a gentle pulse ring (like a heartbeat, 3s cycle, very subtle), "recently active" shows a slow fade between green and yellow, and offline is static gray. Add a "last seen" tooltip on hover showing the exact time (e.g., "Last seen 2 hours ago"). In the room header, show the user's status message alongside their presence. Keep animations GPU-accelerated and respect `prefers-reduced-motion`.

### 4. Swipe Gestures for Mobile
**Current state:** Mobile navigation relies on back buttons and taps. No gesture-based interaction.
**Proposal:** Implement touch gestures:
- **Swipe right on a message** -> Reply (shows reply preview sliding in from the left)
- **Swipe left on a message** -> Show timestamp and read receipts
- **Swipe right from left edge** -> Open sidebar (with elastic overscroll feel)
- **Swipe down on room header** -> Open room info panel
Use `touch-action: pan-y` on the message list to avoid scroll conflicts. Include a 40px activation threshold to prevent accidental triggers. Provide haptic feedback at the activation point.

### 5. Redesigned Settings Panel with Sidebar Navigation
**Current state:** Settings is a modal with tabs (Profile, Security, About) — content is cramped on mobile.
**Proposal:** Redesign settings as a full-screen page (or a slide-over panel on desktop) with a left sidebar showing categories: **Account**, **Appearance**, **Notifications**, **Privacy & Security**, **Devices**, **Advanced**, and **About**. Each category gets a dedicated scrollable content area. On mobile, the category list is the first screen; tapping a category slides to the detail view. Add a search bar at the top of settings to quickly find options. This scales better as more settings are added.

### 6. Emoji Reaction Animations
**Current state:** Reactions appear as static pills with emoji + count below messages.
**Proposal:** Add micro-animations when adding a reaction: the emoji briefly scales up (1.3x) with a bounce easing, then settles. When a reaction count increments, the number does a vertical scroll animation (old number slides up, new slides in from below). First-time reactions use the existing `scaleIn` animation. Long-pressing a reaction shows a tooltip with the list of people who reacted, with their avatars. Add a subtle background gradient to your own reactions to differentiate them more clearly from others'.

### 7. Typing Indicator Redesign
**Current state:** Three pulsing dots with "User is typing..." text in the header.
**Proposal:** Move the typing indicator to appear inline at the bottom of the message list (below the last message), styled as a ghost message bubble from that user. Show the user's avatar alongside animated dots inside a message-shaped container. For multiple typers, stack the indicators or show "Alice and 2 others are typing..." with their mini-avatars. The ghost bubble should smoothly animate in/out with a slide-up + fade. This feels more spatial and connected to the conversation.

### 8. Image Gallery Viewer with Gesture Support
**Current state:** Clicking an image opens a lightbox viewer.
**Proposal:** Enhance the lightbox into a full gallery experience: show navigation arrows to browse all images in the room chronologically, add pinch-to-zoom on mobile, support swipe-left/right to navigate between images, and include a filmstrip thumbnail bar at the bottom. Show image metadata (sender, date, filename, size). Add a download button and a "Jump to message" link. Background should use a `backdrop-filter: blur(20px)` over the chat for depth. Close with swipe-down gesture or tap outside.

### 9. Unread Indicator Redesign
**Current state:** Unread rooms show a circular badge with the count.
**Proposal:** Differentiate unread types visually:
- **Regular unreads**: Subtle bold room name + small count badge (current style, refined)
- **Mentions/keywords**: Bright primary-colored badge with "@" prefix or highlighted keyword
- **Muted rooms with unreads**: Dim gray badge (lower visual priority)
Add a thin left-border accent (3px) on rooms with unreads, colored by priority (blue for mentions, gray for regular). Add a "Mark all as read" action in the sidebar header. Include an unread count in the browser tab title: `(5) Messages`.

### 10. Contextual Message Actions Redesign
**Current state:** Hover reveals action buttons (emoji, reply, more menu) above the message. On mobile, long-press shows a context menu.
**Proposal:** Redesign the action bar to appear as a floating pill that slides in from the right side of the message bubble on hover (desktop) or from below on long-press (mobile). Group actions by frequency: primary row (React, Reply, Forward) always visible, secondary row (Edit, Pin, Delete, Copy, Thread) in an expandable tray. Add a quick-react bar showing the 6 most-used emojis for one-tap reactions. On mobile, use a bottom sheet with haptic feedback instead of a context menu — this is more thumb-friendly and allows larger touch targets. Animate the pill with a scale + fade entrance (150ms).

---

## Summary Matrix

| Category | Count | Impact |
|----------|-------|--------|
| Functionality | 10 | Offline queue, rich composer, global search, scheduling, threads, voice messages, favorites, smart notifications, read-position sync, link previews |
| Security | 5 | HttpOnly token cookies, CSP reporting, self-hosted fonts/SRI, device management, comprehensive rate limiting |
| Design | 10 | Collapsible sidebar, bubble clustering, presence animations, swipe gestures, settings redesign, reaction animations, typing redesign, image gallery, unread redesign, contextual actions redesign |

### Priority Recommendations

Each improvement is designed to be **independently implementable** and **backwards-compatible** with the existing architecture. Priority should be given to:

1. **Offline message queue** (Functionality #1) — highest user frustration point
2. **HttpOnly token migration** (Security #1) — highest security impact
3. **Message grouping refinement** (Design #2) — highest visual impact for effort
