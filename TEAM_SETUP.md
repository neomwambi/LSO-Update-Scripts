# Sharing this app with colleagues

Everyone uses the **same MySQL host** (your company server) but **their own database username and password**. Nothing is hosted on the public internet; each person runs the app on their own laptop with VPN on.

## Option A - `.env` file (good for daily use)

1. Copy `.env.example` to `.env` in this folder.
2. Fill in **your** `MYSQL_*` values (not someone else’s).
3. Never commit `.env` (it is gitignored).

## Option B - No `.env` (good for quick use)

1. Run the app (`npm.cmd run dev`).
2. Open the site in the browser.
3. Expand **“Connect with my credentials (no .env file)”**.
4. Enter host, port, database (if needed), **your** user, and password → **Connect**.

Passwords are sent only to the **local** API on `127.0.0.1`, not to a shared cloud service.

## First-time install (each machine)

```text
cd lso-web-app
npm install
npm.cmd run dev
```

Use **Command Prompt** or `npm.cmd` if PowerShell blocks scripts (execution policy).

## Two folders on one PC

You can keep **two copies** of the project (e.g. `lso-web-app` with your `.env`, and `lso-web-app-team` for sharing a clean tree). They are the same code; update both when you change features, or use one folder + Git.

## Disconnect / switching user

Use **Disconnect** in the UI, then either **Connect from .env** or enter another user’s credentials (for testing). After disconnect, the app will not silently reconnect until you choose.
