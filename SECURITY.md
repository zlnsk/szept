# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | Yes                |

## Reporting a Vulnerability

If you discover a security vulnerability in Messages, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please send an email to **security@example.com** with:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional)

You should receive an acknowledgement within **48 hours**. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This policy applies to the Messages Matrix client application. Issues in upstream dependencies (matrix-js-sdk, Next.js, etc.) should be reported to their respective maintainers, but we appreciate being notified so we can assess impact on Messages.

## Security Measures

Messages implements the following security measures:

- End-to-end encryption via Matrix Olm/Megolm (matrix-sdk-crypto-wasm)
- DOMPurify sanitization for all rendered message HTML
- Content Security Policy with per-request nonce-based script-src
- HSTS with preload, X-Frame-Options DENY, and other hardening headers
- Session tokens stored in localStorage (cleared on logout and idle timeout)
- Relay-only ICE transport policy to prevent IP leakage in calls
- Login rate limiting with exponential backoff
- Idle session timeout with automatic logout
- File upload blocklist for dangerous MIME types and extensions
