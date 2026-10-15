# Launch Desk

A private, one-page Pump coin launch console for a single owner. It pins the uploaded image and token metadata through Pinata, prepares a Pump `create_v2` transaction, asks your browser wallet to sign it, verifies the confirmed transaction, and saves the token in `data/tokens.json`. The dashboard loads saved launches after login and requests market cap and 24-hour volume from DexScreener.

## Run locally

1. Install Node.js 24 or later.
2. Run `npm install` and `npm run build`.
3. Copy `.env.example` to `.env`. Set a long `APP_PASSWORD` and your Pinata `PINATA_JWT`. Keep `.env` private.
4. Run `npm start` and open <http://127.0.0.1:3333> in a browser with Phantom.
5. Log in, connect your funded **Solana mainnet** wallet, fill the launch form, and approve the transaction in the wallet.

On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`.

The app binds to `127.0.0.1` for personal use. The saved token file is local to this machine; back up `data/tokens.json` if you move it. To use the site remotely, deploy it behind HTTPS with persistent storage and an appropriate reverse proxy. Do not expose this local server directly to the internet.

## Launch choices

- Name, ticker, description, image, website, X, Telegram
- SOL or USDC pair
- Optional initial buy, buy slippage, and priority fee
- Mayhem mode and holder rewards

Cashback is absent because Pump has deprecated new cashback coins. Holder rewards are permanent once chosen. The connected wallet signs and pays; no wallet private key is entered into this app. Images and JSON metadata become public on IPFS when you prepare a launch, even if you later decline the transaction.

The dashboard saves only transactions confirmed by the configured RPC. Market values are from DexScreener's most liquid indexed pair for the mint; a dash means an indexed pair or value is unavailable. The dashboard's values are snapshots, not a trading or accounting feed.

## Verification

`npm run check` validates source syntax. `npm run build` bundles browser JavaScript. The on-chain flow requires a funded wallet, Pinata JWT, and mainnet transaction approval, so it cannot be confirmed from a local build alone.
