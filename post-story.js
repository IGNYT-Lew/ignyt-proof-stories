// Posts today's story to @ignyt_fitness. Runs from GitHub Actions on Tue, Thu and Sun.
// Needs: IG_TOKEN (system user token), IMAGE_BASE_URL (public URL of the folder that holds stories/).
// Flags: --dry-run  builds the container and stops before publishing (nothing goes live).
//        --date YYYY-MM-DD  pretend it is that date.   --now  skip the wait until 16:00.
// Everything is checked in London time so the clock change on 25 Oct is handled.
const fs = require('fs');
const path = require('path');

const IG_USER = '17841458549363051';
const GRAPH = 'https://graph.facebook.com/v26.0';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const NOW = args.includes('--now');
const token = process.env.IG_TOKEN;
const base = (process.env.IMAGE_BASE_URL || '').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const london = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
};

async function graph(method, url, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(method === 'GET' ? `${url}?${qs}` : url, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs });
  const j = await res.json();
  if (j.error) throw new Error(`${j.error.code}/${j.error.error_subcode || ''}: ${j.error.message}`);
  return j;
}

(async () => {
  if (!token) throw new Error('IG_TOKEN is not set');
  if (!base) throw new Error('IMAGE_BASE_URL is not set');
  const dateArg = args.indexOf('--date') >= 0 ? args[args.indexOf('--date') + 1] : null;
  const now = london();
  const today = dateArg || now.date;
  const { queue } = JSON.parse(fs.readFileSync(path.join(__dirname, 'queue.json'), 'utf8'));
  const postedPath = path.join(__dirname, 'posted.json');
  const posted = fs.existsSync(postedPath) ? JSON.parse(fs.readFileSync(postedPath, 'utf8')) : [];

  // Each slot posts the next story in the queue that has not gone out yet, so a missed day
  // never skips a review or shifts the order. queue.json dates are only a guide.
  if (posted.some((p) => p.date === today && p.status === 'published')) return log(`Already posted for ${today}.`);
  const done = new Set(posted.filter((p) => p.status === 'published').map((p) => p.id || p.n));
  const entry = queue.find((e) => !done.has(e.id || e.n));
  if (!entry) return log('Queue is empty. Nothing left to post.');

  // Two cron triggers cover both UK clock settings. The one that fires before 16:00 London waits;
  // the other finds the story already posted, or is outside the window, and stops.
  if (!NOW && !dateArg) {
    if (now.hour > 17) return log(`Too late today (London ${now.hour}:${now.minute}). Skipping.`);
    if (now.hour < 15) return log(`Too early (London ${now.hour}:${now.minute}). Skipping.`);
    while (london().hour < 16) { log('Waiting for 16:00 London...'); await sleep(30000); }
  }

  const imageUrl = `${base}/${entry.image}`;
  log(`Story ${entry.n}/${queue.length}: ${entry.name}, style ${entry.style}, ${imageUrl}`);

  // Make sure the image is reachable before asking Instagram to fetch it.
  const head = await fetch(imageUrl, { method: 'HEAD' });
  if (!head.ok) throw new Error(`Image not reachable (${head.status}): ${imageUrl}`);

  const container = await graph('POST', `${GRAPH}/${IG_USER}/media`, { media_type: 'STORIES', image_url: imageUrl });
  log('Container created', container.id);
  for (let i = 0; i < 20; i++) {
    const s = await graph('GET', `${GRAPH}/${container.id}`, { fields: 'status_code' });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Container status ' + s.status_code);
    await sleep(3000);
  }
  if (DRY) return log('Dry run: container ready, NOT published.');

  const pub = await graph('POST', `${GRAPH}/${IG_USER}/media_publish`, { creation_id: container.id });
  log('Published story', pub.id);
  posted.push({ date: today, n: entry.n, id: entry.id, name: entry.name, style: entry.style, mediaId: pub.id, status: 'published', at: new Date().toISOString() });
  fs.writeFileSync(postedPath, JSON.stringify(posted, null, 2));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
