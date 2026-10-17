# Launch Desk

A private, one-page Pump coin launch console for a single owner. It pins the uploaded image and token metadata through Pinata, prepares a Pump `create_v2` transaction, asks your browser wallet to sign it, verifies the confirmed transaction, and saves the token locally or in private Vercel Blob storage. The dashboard loads saved launches after login and requests market cap and 24-hour volume from DexScreener.

## Run locally

1. Install Node.js 24 or later.
2. Run `npm install` and `npm run build`.
3. Copy `.env.example` to `.env`. Set a long `APP_PASSWORD` and your Pinata `PINATA_JWT`. Keep `.env` private.
4. Run `npm start` and open <http://127.0.0.1:3333> in a browser with Phantom.
5. Log in, connect your funded **Solana mainnet** wallet, fill the launch form, and approve the transaction in the wallet.

On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`.

The app binds to `127.0.0.1` for personal use. The saved token file is local to this machine; back up `data/tokens.json` if you move it.

## Deploy on Vercel

1. Import the repository into Vercel. The `npm run build` script generates `public/bundle.js` during deployment.
2. Create a **private** Vercel Blob store and connect it to the project. It supplies `BLOB_READ_WRITE_TOKEN` for persistent launch records.
3. Set `APP_PASSWORD`, `PINATA_JWT`, and optionally `SOLANA_RPC_URL` in the project's Production environment variables, then deploy. The Pinata key must allow Files write access for public uploads. Use a long, unique password. `PORT` is only for local use.

Sessions use signed, seven-day cookies. Logging out clears the browser cookie; changing `APP_PASSWORD` invalidates all existing sessions. The deployment requires HTTPS and limits image uploads to 4 MB to fit Vercel's request limit. Local `data/tokens.json` records are not automatically migrated to Blob storage.

## Launch choices

- Name, ticker, description, image, website, X, Telegram
- SOL or USDC pair
- Optional initial buy, buy slippage, and priority fee
- Mayhem mode and holder rewards

Cashback is absent because Pump has deprecated new cashback coins. Holder rewards are permanent once chosen. The connected wallet signs and pays; no wallet private key is entered into this app. Images and JSON metadata become public on IPFS when you prepare a launch, even if you later decline the transaction.

The dashboard saves only transactions confirmed by the configured RPC. Market values are from DexScreener's most liquid indexed pair for the mint; a dash means an indexed pair or value is unavailable. The dashboard's values are snapshots, not a trading or accounting feed.

## Verification

`npm run check` validates source syntax. `npm run build` bundles browser JavaScript. The on-chain flow requires a funded wallet, Pinata JWT, and mainnet transaction approval, so it cannot be confirmed from a local build alone.
