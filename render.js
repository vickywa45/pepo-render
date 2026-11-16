// Perender MP4 animasi video Pepo (pepo202) — dijalankan GitHub Actions, dipicu dari tombol "Render MP4" di Pepo.
// Alur: ambil tugas dari Pepo (/api/motion-render/worker) → buka halaman animasi di Chromium → panggil setT(t) per frame
// → JPEG ke ffmpeg (H.264 1080×1920, 30 fps) → musik (opsional) → unggah ke alamat sekali pakai → lapor selesai.
// LOG SENGAJA BERSIH (repo publik): tidak mencetak isi halaman, URL, nama, atau token. Hanya progres & pesan error singkat.
//
// Mode lokal untuk mencoba tanpa Pepo:  node render.js --local animasi.html hasil.mp4 [musik.mp3]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCAL = process.argv[2] === '--local';
const API = (process.env.PEPO_API || 'https://pepoai.id').replace(/\/+$/, '');
const TOKEN = process.env.PEPO_RENDER_TOKEN || '';
const JOB = process.env.JOB_ID || '';
const clean = (s) => String(s || '').replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9_-]{32,}/g, '[…]').slice(0, 280);
const log = (...a) => console.log('[render]', ...a);

async function api(method, body) {
  const url = `${API}/api/motion-render/worker` + (method === 'GET' ? `?id=${encodeURIComponent(JOB)}` : '');
  const r = await fetch(url, { method, headers: { 'x-pepo-render-token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Pepo menjawab ${r.status}${j && j.error ? ' (' + j.error + ')' : ''}`);
  return j;
}
const report = (status, extra = {}) => (LOCAL ? Promise.resolve() : api('POST', { id: JOB, status, ...extra }).catch(() => null));

function run(cmd, args, input) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} keluar ${c}: ${clean(err.split('\n').filter(Boolean).pop())}`))));
    if (input) input(p);
  });
}

async function main() {
  let job;
  if (LOCAL) {
    const [, , , file, out, music] = process.argv;
    if (!file || !out) throw new Error('Pakai: node render.js --local animasi.html hasil.mp4 [musik]');
    // Mode lokal memakai pemutar dari file kit (salinan motionDoc render) bila halaman belum berisi pemutar
    const html = fs.readFileSync(file, 'utf8');
    if (!/pepo-motion-kit/.test(html)) throw new Error('File lokal harus dokumen siap rekam (berisi pemutar Pepo mode render).');
    job = { doc: html, fps: 30, title: path.basename(file), musicFile: music, out, file: path.resolve(file) };
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(JOB)) throw new Error('JOB_ID tidak valid');
    if (TOKEN.length < 16) throw new Error('Secret PEPO_RENDER_TOKEN belum diisi');
    job = await api('GET');
  }
  const fps = Math.max(12, Math.min(60, Number(job.fps) || 30));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pepo-'));
  // Lokal: dibuka dari tempatnya supaya gambar relatif ikut termuat. Dari Pepo: alamat aset sudah absolut (<base>).
  const docFile = job.file || path.join(tmp, 'index.html');
  if (!job.file) fs.writeFileSync(docFile, job.doc);

  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-gpu-vsync'] });
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => log('error di halaman:', clean(e.message)));
  await page.goto('file://' + docFile, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.PEPO_READY || window.PEPO_ERROR, null, { timeout: 90_000 });
  const stage = await page.evaluate(() => window.PEPO_STAGE || null);
  if (!stage) throw new Error('Kontrak animasi tidak lengkap (#stage / window.setT).');
  // Panggung digambar pada sisi pendek 1080 px (9:16 → 1080×1920, 16:9 → 1920×1080, 1:1 → 1080×1080)
  const scale = 1080 / Math.min(stage.w, stage.h);
  const W = Math.round(stage.w * scale / 2) * 2, H = Math.round(stage.h * scale / 2) * 2;
  if (stage.w !== 540 || stage.h !== 960 || scale !== 2) {
    await page.close();
    const p2 = await browser.newPage({ viewport: { width: stage.w, height: stage.h }, deviceScaleFactor: scale });
    await p2.goto('file://' + docFile, { waitUntil: 'load', timeout: 90_000 });
    await p2.waitForFunction(() => window.PEPO_READY, null, { timeout: 90_000 });
    job._page = p2;
  }
  const pg = job._page || page;
  const D = Math.min(180, Number(stage.d) || Number(job.duration) || 10);
  const n = Math.round(D * fps);
  log(`mulai: ${D.toFixed(1)} dtk, ${n} frame, ${W}×${H} @${fps}fps`);
  await report('running', { progress: 2 });

  const vid = path.join(tmp, 'video.mp4');
  let lastPct = 0;
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', vid], async (p) => {
    try {
      for (let f = 0; f < n; f++) {
        await pg.evaluate((t) => window.setT(t), f / fps);
        const buf = await pg.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: stage.w, height: stage.h } });
        if (!p.stdin.write(buf)) await new Promise((r) => p.stdin.once('drain', r));
        const pct = Math.floor((f / n) * 88) + 2;
        if (pct >= lastPct + 5) { lastPct = pct; log(`frame ${f}/${n} (${pct}%)`); void report('running', { progress: pct }); }
      }
    } catch (e) { log('gagal merekam frame:', clean(e.message)); }
    p.stdin.end();
  });
  await browser.close();

  let final = vid;
  const musicSrc = job.musicFile || job.musicUrl;
  if (musicSrc) {
    try {
      const mfile = path.join(tmp, 'music');
      if (/^https:\/\//.test(musicSrc)) { const r = await fetch(musicSrc); if (!r.ok) throw new Error('musik ' + r.status); fs.writeFileSync(mfile, Buffer.from(await r.arrayBuffer())); }
      else fs.copyFileSync(musicSrc, mfile);
      const withA = path.join(tmp, 'final.mp4');
      const fade = Math.min(3, D / 4);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', vid, '-stream_loop', '-1', '-i', mfile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', `atrim=0:${D.toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${(D - fade).toFixed(2)}:d=${fade.toFixed(2)}`, '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', withA]);
      final = withA; log('musik ditambahkan');
    } catch (e) { log('musik dilewati:', clean(e.message)); }
  }
  await report('running', { progress: 94 });

  if (LOCAL) { fs.copyFileSync(final, job.out); log('selesai →', job.out); return; }
  const bytes = fs.readFileSync(final);
  const up = await fetch(job.upload.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: bytes });
  if (!up.ok) throw new Error('unggah MP4 gagal (' + up.status + ')');
  await report('done');
  log(`selesai: ${(bytes.length / 1048576).toFixed(1)} MB`);
}

main().catch(async (e) => {
  const m = clean(e && e.message || e);
  console.error('[render] GAGAL:', m);
  await report('failed', { error: m });
  process.exit(1);
});
