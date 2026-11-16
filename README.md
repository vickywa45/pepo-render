# pepo-render

Perender MP4 untuk **animasi video Pepo** (pepo202). Dipicu dari tombol **Render MP4** di kartu animasi
(hanya terlihat oleh akun admin Pepo). GitHub Actions membuka animasi di Chromium, merekam setiap frame
(`window.setT(t)`), menggabungkannya jadi MP4 1080×1920 30 fps, menambahkan musik bila diisi, lalu
mengunggahnya ke Supabase Pepo lewat alamat sekali pakai.

Repo ini **boleh publik** (menit Actions tidak dibatasi). Yang perlu diketahui:
- Kode & log terlihat orang lain. Log sengaja bersih: hanya progres, tanpa URL, nama, atau isi animasi.
- Secrets tidak bisa dibaca dari luar. Orang asing tidak bisa memicu workflow (butuh akses tulis).
- Jangan dipakai untuk merender video milik pengguna umum: ketentuan GitHub membatasi Actions untuk
  pekerjaan proyek ini sendiri. Gunakan untuk iklan/konten Pepo milikmu.

## Pasang (sekali)

1. **Buat repo publik** `pepo-render` di GitHub, unggah semua file di folder ini
   (termasuk folder `.github/workflows/`).
2. **Buat token pekerja** `PEPO_RENDER_TOKEN`: teks acak minimal 32 karakter
   (mis. dari generator kata sandi, hanya huruf & angka). Simpan, dipakai di dua tempat.
3. **Secrets repo** → Settings → Secrets and variables → Actions → *New repository secret*:
   - `PEPO_API` = alamat Pepo yang tidak dialihkan (buka `https://pepoai.id/api/version` di browser;
     bila alamatnya berubah ke `www.`, pakai yang `www.`)
   - `PEPO_RENDER_TOKEN` = token dari langkah 2
4. **Token GitHub untuk Pepo**: GitHub → Settings → Developer settings → Personal access tokens →
   *Fine-grained tokens* → Generate. Repository access: **Only select repositories → pepo-render**.
   Permissions → Repository → **Actions: Read and write**. Salin tokennya.
5. **Env Vercel (proyek Pepo)**, lalu Redeploy:
   - `PEPO_RENDER_REPO` = `namamu/pepo-render`
   - `PEPO_RENDER_GH_TOKEN` = token dari langkah 4
   - `PEPO_RENDER_TOKEN` = token dari langkah 2 (sama persis)
6. **Supabase PEPO → SQL Editor**: jalankan `pepo-v25.sql` dari patch pepo202.

## Pakai

Kartu animasi video di Pepo → **Render MP4** → (opsional) URL musik mp3/wav → **Mulai render**.
Kartu menampilkan "Menunggu mesin GitHub menyala…" → "Merekam frame… N%" → video + **Unduh MP4**.
Video 75 detik ±5–8 menit. Progres juga terlihat di tab **Actions** repo ini.

Gagal? Kartu menampilkan alasannya. Yang umum: secret belum diisi, `PEPO_API` beralih alamat (pakai yang
`www.`/tanpa `www.` sesuai langkah 3), token GitHub tidak punya izin Actions, atau SQL belum dijalankan.

## Coba di komputer sendiri (opsional, untuk pengembang)

```
npm install && npx playwright install chromium
node render.js --local animasi-render.html hasil.mp4 [musik.mp3]
```
`animasi-render.html` = dokumen animasi yang sudah berisi pemutar Pepo mode render.
