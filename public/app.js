import { VersionedTransaction } from '@solana/web3.js';

const $ = id => document.getElementById(id);
let wallet = null;
const fmtMoney = n => n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n);
async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function showApp(yes) { $('loginView').hidden = yes; $('appView').hidden = !yes; $('logout').hidden = !yes; if (yes) { loadTokens(); recoverPending(); } }
async function loadTokens() {
  try {
    const records = await api('/api/tokens');
    $('count').textContent = records.length;
    const list = $('tokenList'); list.replaceChildren();
    if (!records.length) { list.innerHTML = '<div class="empty">Your confirmed launches will appear here.</div>'; $('totalVolume').textContent = '—'; return; }
    let total = 0, known = false;
    await Promise.all(records.map(async record => {
      const row = document.createElement('div'); row.className = 'token-row';
      const asset = document.createElement('div'); asset.className = 'asset';
      const img = document.createElement('img'); img.src = record.image; img.alt = '';
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = record.name;
      const symbol = document.createElement('small'); symbol.textContent = `${record.symbol} · ${record.mint.slice(0, 5)}…${record.mint.slice(-4)}`;
      info.append(title, symbol); asset.append(img, info);
      const cap = document.createElement('span'); cap.textContent = '—';
      const vol = document.createElement('span'); vol.textContent = '—';
      const link = document.createElement('a'); link.href = `https://pump.fun/coin/${record.mint}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'row-link'; link.title = 'Open on Pump'; link.textContent = '↗';
      row.append(asset, cap, vol, link); list.append(row);
      try { const m = await api(`/api/metrics?mint=${encodeURIComponent(record.mint)}`); cap.textContent = fmtMoney(m.marketCap); vol.textContent = fmtMoney(m.volume24h); if (m.volume24h != null) { total += m.volume24h; known = true; $('totalVolume').textContent = fmtMoney(total); } }
      catch { /* Missing live data remains a dash. */ }
    }));
    if (!known) $('totalVolume').textContent = '—';
  } catch (e) { $('tokenList').textContent = e.message; }
}
async function recoverPending() {
  const pending = JSON.parse(localStorage.getItem('pendingLaunch') || 'null');
  if (!pending) return;
  try {
    await api('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
    localStorage.removeItem('pendingLaunch');
    $('launchStatus').textContent = 'Previous launch confirmed and saved.';
    loadTokens();
  } catch { $('launchStatus').textContent = `A previous transaction is still pending: ${pending.signature}`; }
}
$('loginForm').addEventListener('submit', async e => { e.preventDefault(); $('loginError').textContent = ''; try { await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; showApp(true); } catch (error) { $('loginError').textContent = error.message; } });
$('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showApp(false); });
$('refresh').addEventListener('click', loadTokens);
$('quote').addEventListener('change', () => { $('buyUnit').textContent = $('quote').value; });
$('image').addEventListener('change', () => { const file = $('image').files[0]; if (!file) return; $('imageName').textContent = file.name; const reader = new FileReader(); reader.onload = () => { $('imagePreview').innerHTML = ''; const img = document.createElement('img'); img.src = reader.result; img.alt = 'Image preview'; $('imagePreview').append(img); }; reader.readAsDataURL(file); });
$('connectWallet').addEventListener('click', async () => { const provider = window.solana?.isPhantom ? window.solana : window.phantom?.solana; if (!provider) { $('launchStatus').textContent = 'Install Phantom or open this page in a browser with Phantom enabled.'; return; } try { const result = await provider.connect(); wallet = provider; $('walletLabel').textContent = result.publicKey.toBase58(); $('connectWallet').textContent = 'Connected ✓'; $('launchStatus').textContent = ''; } catch (e) { $('launchStatus').textContent = e.message; } });
$('launchForm').addEventListener('submit', async e => {
  e.preventDefault(); const status = $('launchStatus');
  if (!wallet?.publicKey) { status.textContent = 'Connect your wallet first.'; return; }
  if ($('image').files[0]?.size > 4 * 1024 * 1024) { status.textContent = 'Choose an image under 4 MB.'; return; }
  const button = $('launchButton'); button.disabled = true;
  try {
    const form = new FormData(e.currentTarget); form.set('wallet', wallet.publicKey.toBase58()); form.set('mayhemMode', String(form.has('mayhemMode'))); form.set('holderReward', String(form.has('holderReward')));
    status.textContent = 'Uploading image and metadata to Pinata…';
    const prepared = await api('/api/prepare', { method: 'POST', body: form });
    status.textContent = 'Review and sign the launch in your wallet…';
    const bytes = Uint8Array.from(atob(prepared.transaction), c => c.charCodeAt(0));
    const tx = VersionedTransaction.deserialize(bytes);
    const result = await wallet.signAndSendTransaction(tx);
    const signature = result.signature;
    localStorage.setItem('pendingLaunch', JSON.stringify({ mint: prepared.mint, signature }));
    status.textContent = 'Waiting for on-chain confirmation…';
    let confirmed = false;
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      try { await api('/api/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint: prepared.mint, signature }) }); confirmed = true; break; } catch { /* RPC indexing can lag. */ }
    }
    if (!confirmed) throw new Error(`Transaction sent (${signature}). Confirmation is still pending; keep this signature to recover it.`);
    localStorage.removeItem('pendingLaunch');
    status.innerHTML = `Token created. <a href="https://pump.fun/coin/${prepared.mint}" target="_blank" rel="noopener noreferrer">View on Pump ↗</a>`;
    e.currentTarget.reset(); $('imagePreview').textContent = '↑'; $('imageName').textContent = 'Choose an image'; loadTokens();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
api('/api/session').then(() => showApp(true)).catch(() => showApp(false));
