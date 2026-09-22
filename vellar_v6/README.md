# Vellar v6 — Telegram Mini App + TON Connect

This version keeps the Vellar game backend from v5 and adds the real Telegram Mini App integration and TON Connect wallet connection.

## 1. Local test

1. Install Node.js 18+.
2. Copy `.env.example` to `.env`.
3. Keep `DEV_MODE=true` for browser testing.
4. Run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

The local browser uses the DEV login. Telegram authentication is used automatically when the app is opened inside Telegram and `BOT_TOKEN` is configured.

## 2. Telegram production setup

Create/configure the bot with @BotFather. Put the BotFather token into `.env` locally or in Railway Variables. Do not put the token in frontend code or GitHub.

Set:

- `APP_URL=https://your-real-domain.example`
- `BOT_TOKEN=...`
- `WEBHOOK_SECRET=...`
- `DEV_MODE=false`

Deploy the server first, then run:

```bash
npm run setup:telegram
```

This configures the Telegram webhook, `/start`, `/help` command list, and the bot menu button.

The bot sends a Mini App button on `/start`. Telegram validates Mini App `initData` on the server before a session is created.

## 3. Telegram Stars citizenship

Citizenship is a digital game access item. The backend creates an XTR invoice and only grants citizenship after a `successful_payment` update. The `pre_checkout_query` is also checked against the stored payment record and expected amount.

Default: 500 Stars.

Change `CITIZENSHIP_STARS` if needed.

## 4. TON Connect

The frontend uses the official `@tonconnect/ui` browser bundle from the TON Connect CDN.

The backend serves `/tonconnect-manifest.json` dynamically from `APP_URL`.

A public HTTPS URL is required for production wallets. The manifest and PNG icon must be publicly reachable.

The wallet address is stored on the server after connection. No seed phrase or private key is ever requested.

## 5. Important security boundary

Wallet connection is implemented in v6. It is NOT yet sufficient to treat a wallet as cryptographically proven ownership for collateral or SA payments.

Before real SA/USDT collateral is enabled, add `ton_proof` verification on the backend and verify every on-chain payment/Jetton transfer server-side with replay protection.

Do not trust a price typed by the browser for SA collateral.

## 6. Next blockchain step

After the wallet connection is tested, the next version should add:

1. TON Proof wallet binding.
2. SA Jetton payment for citizenship.
3. Server-side SA transaction verification.
4. SA/USDT deposit records tied to the verified wallet.
5. Real on-chain collateral locks or a clearly defined custody model.

Never request a seed phrase or private key from users.
