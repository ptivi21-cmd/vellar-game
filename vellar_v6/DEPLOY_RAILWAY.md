# Deploy Vellar v6 to Railway

1. Upload this project to GitHub.
2. Create a Railway service from the repository.
3. Railway will run `npm start`.
4. Add Variables:

- `BOT_TOKEN` = token from @BotFather
- `BOT_USERNAME` = `VellarCitizenBot`
- `APP_URL` = Railway public HTTPS URL
- `WEBHOOK_SECRET` = long random string
- `DEV_MODE` = `false`
- `CITIZENSHIP_STARS` = `500`
- `PROJECT_WALLET_ADDRESS` = `UQDpHoPi5JHFruwdiKHCGO68gVaW4lKN0arzTAoMWVDWrjuv`
- `SA_MASTER_ADDRESS` = `EQBW1ZPnrV2LujIKfwdctIy57c5-RFlkxAZDo9-CN5BtTWmC`

5. After the service is live, run locally with the same BOT_TOKEN/APP_URL/WEBHOOK_SECRET:

`npm install`

`npm run setup:telegram`

The script calls Telegram's Bot API to set the webhook, `/start` and `/help` commands, and the bot menu button.

6. Open `https://YOUR-APP/tonconnect-manifest.json` in a browser. It must return JSON. The TON Connect manifest is required to be public over HTTPS.

7. In @BotFather, set the bot's Main Mini App to the same HTTPS URL if you want the prominent Launch App button.

Never commit `.env` or the bot token to GitHub.
