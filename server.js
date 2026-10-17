import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { get, list, put } from '@vercel/blob';

const require = createRequire(import.meta.url);
const { PumpSdk, OnlinePumpSdk, PUMP_PROGRAM_ID, getBuyTokenAmountFromSolAmount } = require('@pump-fun/pump-sdk');

const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(root, 'data', 'tokens.json');
const app = express();
const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');
const sdk = new PumpSdk();
const onlineSdk = new OnlinePumpSdk(connection);
const sessionLifetime = 7 * 86400_000;
const blobEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
if (process.env.VERCEL && !blobEnabled) throw new Error('Connect a private Vercel Blob store to this project.');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '40kb' }));
app.use(express.static(path.join(root, 'public')));

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Invalid origin.' });
  next();
}
app.use('/api', sameOrigin);

function auth(req, res, next) {
  const token = /(?:^|; )session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!validSession(token)) return res.status(401).json({ error: 'Please log in.' });
  next();
}
function sessionSignature(payload) {
  return crypto.createHmac('sha256', process.env.APP_PASSWORD || '').update(`launch-desk-session:${payload}`).digest('base64url');
}
function validSession(token) {
  if (!process.env.APP_PASSWORD || typeof token !== 'string') return false;
  const [expiry, nonce, signature, extra] = token.split('.');
  if (extra || !/^\d{13}$/.test(expiry || '') || !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[A-Za-z0-9_-]{43}$/.test(signature || '') || Number(expiry) < Date.now()) return false;
  return safeEqual(signature, sessionSignature(`${expiry}.${nonce}`));
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
async function readDb() {
  if (blobEnabled) {
    const records = [];
    let cursor;
    do {
      const page = await list({ prefix: 'launches/', cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const result = await get(blob.pathname, { access: 'private', useCache: false });
        if (result?.statusCode === 200) records.push(await new Response(result.stream).json());
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return records;
  }
  try { return JSON.parse(await fs.readFile(dbPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function saveRecord(record) {
  if (blobEnabled) {
    await put(`launches/${record.mint}.json`, JSON.stringify(record), { access: 'private', allowOverwrite: true, contentType: 'application/json' });
    return;
  }
  const records = await readDb();
  const index = records.findIndex(x => x.mint === record.mint);
  if (index < 0) records.push(record); else records[index] = record;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const temp = `${dbPath}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(records, null, 2));
  await fs.rename(temp, dbPath);
}
async function readRecord(mint) {
  if (blobEnabled) {
    const result = await get(`launches/${mint}.json`, { access: 'private', useCache: false });
    return result?.statusCode === 200 ? new Response(result.stream).json() : null;
  }
  return (await readDb()).find(x => x.mint === mint) || null;
}
function requiredString(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label} is required (max ${max} characters).`);
  return value.trim();
}
function optionalUrl(value, label) {
  if (!value) return '';
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.href.length > 250) throw new Error(`Invalid ${label} URL.`);
  return url.href;
}
function decimalUnits(value, decimals, label) {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(String(value))) throw new Error(`Invalid ${label}.`);
  const [whole, fraction = ''] = String(value).split('.');
  if (fraction.length > decimals) throw new Error(`${label} has too many decimal places.`);
  return new BN(whole).mul(new BN(10).pow(new BN(decimals))).add(new BN(fraction.padEnd(decimals, '0') || '0'));
}
async function uploadPublicFile(buffer, mime, name, label) {
  const form = new FormData();
  form.append('network', 'public');
  form.append('file', new Blob([buffer], { type: mime }), name);
  const response = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.data?.cid) throw new Error(`Pinata ${label} upload failed: ${result.error?.details || result.error?.reason || response.status}`);
  return `https://gateway.pinata.cloud/ipfs/${result.data.cid}`;
}
async function pinFile(buffer, mime, name) {
  return uploadPublicFile(buffer, mime, name, 'image');
}
async function pinJson(content) {
  return uploadPublicFile(Buffer.from(JSON.stringify(content)), 'application/json', `${content.symbol}-metadata.json`, 'metadata');
}

app.post('/api/login', (req, res) => {
  if (!process.env.APP_PASSWORD || !safeEqual(String(req.body.password || ''), process.env.APP_PASSWORD)) return res.status(401).json({ error: 'Incorrect password.' });
  const payload = `${Date.now() + sessionLifetime}.${crypto.randomBytes(16).toString('hex')}`;
  const token = `${payload}.${sessionSignature(payload)}`;
  res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure || Boolean(process.env.VERCEL), maxAge: sessionLifetime, path: '/' });
  res.json({ ok: true });
});
app.post('/api/logout', auth, (req, res) => {
  res.clearCookie('session', { path: '/' });
  res.json({ ok: true });
});
app.get('/api/session', auth, (_req, res) => res.json({ ok: true }));
app.get('/api/tokens', auth, async (_req, res, next) => {
  try { res.json((await readDb()).filter(x => x.status === 'confirmed').sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  catch (e) { next(e); }
});
app.get('/api/metrics', auth, async (req, res, next) => {
  try {
    const mint = new PublicKey(String(req.query.mint)).toBase58();
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Market data service returned ${response.status}.`);
    const pairs = await response.json();
    const pair = (Array.isArray(pairs) ? pairs : []).filter(p => p.baseToken?.address === mint).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    res.json(pair ? { marketCap: pair.marketCap ?? null, volume24h: pair.volume?.h24 ?? null, priceUsd: pair.priceUsd ?? null, pairUrl: pair.url, updatedAt: new Date().toISOString() } : { marketCap: null, volume24h: null, priceUsd: null, pairUrl: null, updatedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});

app.post('/api/prepare', auth, upload.single('image'), async (req, res, next) => {
  try {
    if (!process.env.PINATA_JWT) throw new Error('Set PINATA_JWT first.');
    if (!req.file || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(req.file.mimetype)) throw new Error('Choose a PNG, JPEG, WebP, or GIF image under 4 MB.');
    const name = requiredString(req.body.name, 32, 'Name');
    const symbol = requiredString(req.body.symbol, 13, 'Symbol');
    const description = requiredString(req.body.description, 1000, 'Description');
    const wallet = new PublicKey(requiredString(req.body.wallet, 60, 'Wallet'));
    const quote = req.body.quote === 'USDC' ? 'USDC' : 'SOL';
    const quoteMint = quote === 'USDC' ? new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') : undefined;
    const initialBuy = decimalUnits(req.body.initialBuy || '0', quote === 'SOL' ? 9 : 6, 'Initial buy');
    const slippage = Number(req.body.slippage || 1);
    const priorityFee = Number(req.body.priorityFee || 0);
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) throw new Error('Slippage must be 0–50%.');
    if (!Number.isFinite(priorityFee) || priorityFee < 0 || priorityFee > 1_000_000) throw new Error('Priority fee must be 0–1,000,000 micro-lamports per compute unit.');
    const website = optionalUrl(req.body.website, 'website');
    const twitter = optionalUrl(req.body.twitter, 'X');
    const telegram = optionalUrl(req.body.telegram, 'Telegram');
    const mayhemMode = req.body.mayhemMode === 'true';
    const holderReward = req.body.holderReward === 'true';
    const image = await pinFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    const metadataUri = await pinJson({ name, symbol, description, image, external_url: website, twitter, telegram, website, showName: true });
    const mint = Keypair.generate();
    const base = { mint: mint.publicKey, name, symbol, uri: metadataUri, creator: wallet, user: wallet, mayhemMode, holderReward, ...(quoteMint ? { quoteMint } : {}) };
    let instructions;
    if (initialBuy.isZero()) instructions = [await sdk.createV2Instruction(base)];
    else {
      const global = await onlineSdk.fetchGlobal();
      const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null, amount: initialBuy, quoteMint: quoteMint || new PublicKey('So11111111111111111111111111111111111111112') });
      instructions = await sdk.createV2AndBuyV2Instructions({ ...base, global, amount, quoteAmount: initialBuy, slippage });
    }
    if (priorityFee) instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }));
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions }).compileToV0Message());
    transaction.sign([mint]);
    await saveRecord({ mint: mint.publicKey.toBase58(), wallet: wallet.toBase58(), name, symbol, description, image, metadataUri, quote, initialBuy: req.body.initialBuy || '0', mayhemMode, holderReward, status: 'prepared', createdAt: new Date().toISOString() });
    res.json({ mint: mint.publicKey.toBase58(), transaction: Buffer.from(transaction.serialize()).toString('base64'), blockhash, lastValidBlockHeight });
  } catch (e) { next(e); }
});
app.post('/api/confirm', auth, async (req, res, next) => {
  try {
    const mint = new PublicKey(String(req.body.mint)).toBase58();
    const signature = requiredString(req.body.signature, 100, 'Signature');
    const record = await readRecord(mint);
    if (!record) return res.status(404).json({ error: 'Prepared launch not found.' });
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) throw new Error('Transaction is not confirmed successfully yet. Try again shortly.');
    const keys = tx.transaction.message.staticAccountKeys.map(x => x.toBase58());
    if (!keys.includes(mint) || !keys.includes(record.wallet) || !keys.includes(PUMP_PROGRAM_ID.toBase58())) throw new Error('Transaction does not match this launch.');
    record.status = 'confirmed';
    record.signature = signature;
    record.confirmedAt = new Date().toISOString();
    await saveRecord(record);
    res.json(record);
  } catch (e) { next(e); }
});
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 400).json({ error: error.message || 'Request failed.' });
});

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3333);
  app.listen(port, '127.0.0.1', () => console.log(`Personal launchpad: http://127.0.0.1:${port}`));
}
export default app;
