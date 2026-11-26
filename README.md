# Muse AI Auto-Allow

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-2563EB?logo=googlechrome&logoColor=white)](manifest.json)
[![CI](https://github.com/mujilabs-sudo/muse-ai-auto-allow/actions/workflows/ci.yml/badge.svg)](https://github.com/mujilabs-sudo/muse-ai-auto-allow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-16A34A.svg)](LICENSE)

Ekstensi Google Chrome (**Manifest V3**) yang secara otomatis mengklik tombol **Allow** ketika pop-up atau kartu konfirmasi dari **Muse AI** muncul — lengkap dengan **Mode Aman (Safe Mode)** agar aksi sensitif tetap memerlukan persetujuan manual.

---

## Fitur Utama

- **Deteksi Cerdas & Real-time**: Memantau DOM halaman, **Shadow DOM**, dan **iframe** (`all_frames: true`) pada `muse.ai`, `muse.meta.com`, dan `meta.ai` tanpa membebani browser.
- **Anti Salah Klik**: Memastikan tombol `Allow` / `Allow once` / `Always allow` / `Izinkan` benar-benar berasal dari kartu atau dialog persetujuan (bukan banner cookie atau tombol biasa).
- **Mode Aman (Safe Mode)**: Secara default melewati pop-up yang mengandung kata kunci sensitif (`payment`, `purchase`, `checkout`, `transfer`, `delete account`, `password`, `pembayaran`, `hapus akun`, dll.) dan menampilkan peringatan. Daftar kata kunci dapat disesuaikan.
- **Prioritas Tombol Fleksibel**:
  - `Allow / Allow once` *(Disarankan)* — memilih izin sekali pakai terlebih dahulu.
  - `Prioritaskan Always allow` — memilih `Always allow` / `Selalu izinkan` jika tersedia.
- **Dukungan Domain Kustom**: Jika overlay/pop-up Muse AI muncul di situs lain, klik **"Aktifkan di situs ini"** di popup ekstensi untuk memberi izin khusus ke domain tersebut.
- **Kontrol & Transparansi**: Toggle ON/OFF instan, pengaturan jeda klik (`0–5000 ms`), badge penghitung klik harian, toast notifikasi non-mengganggu, riwayat klik terbaru, serta dukungan tema terang/gelap mengikuti sistem.

---

## Cara Install di Google Chrome

### Opsi 1 — Dari GitHub Releases (Paling Mudah)
1. Unduh file `muse-ai-auto-allow-v*.zip` terbaru di halaman **Releases**.
2. Ekstrak file `.zip` tersebut ke sebuah folder.
3. Buka `chrome://extensions` di Google Chrome.
4. Aktifkan **Developer mode** (pojok kanan atas).
5. Klik **Load unpacked** lalu pilih folder hasil ekstraksi.

### Opsi 2 — Dari Source Code
```bash
git clone https://github.com/mujilabs-sudo/muse-ai-auto-allow.git
```
1. Buka `chrome://extensions` di Google Chrome.
2. Aktifkan **Developer mode** (pojok kanan atas).
3. Klik **Load unpacked** dan pilih folder `muse-ai-auto-allow`.
4. Pin ikon **Muse AI Auto-Allow** di toolbar Chrome untuk membuka panel kontrol.

---

## Struktur Proyek

```text
muse-ai-auto-allow/
├── manifest.json                 # Konfigurasi Chrome Extension Manifest V3
├── background/
│   └── service-worker.js         # Penyimpanan state, badge, log, dan skrip domain kustom
├── content/
│   └── content.js                # Observer DOM/Shadow DOM, eksekutor klik, dan toast
├── shared/
│   └── matcher.js                # Logika pencocokan pop-up Muse AI & filter Safe Mode
├── popup/
│   ├── popup.html                # UI panel kontrol ekstensi
│   ├── popup.css                 # Styling adaptif light/dark mode
│   └── popup.js                  # Interaksi pengaturan, statistik, & izin domain kustom
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── scripts/
│   ├── generate_icons.py         # Generator ikon PNG (Python stdlib)
│   ├── validate.mjs              # Validasi manifest, dimensi ikon, CSP, & sintaks JS
│   └── package.mjs               # Pembentuk file ZIP rilis bersih (tanpa dependensi luar)
└── tests/
    └── matcher.test.mjs          # Unit test deteksi pop-up & Safe Mode
```

---

## Pengembangan & Pengujian

Tidak memerlukan instalasi `npm install` (nol dependensi eksternal, cukup Node.js 20+):

```bash
# Validasi manifest, dimensi ikon PNG, aturan CSP, dan sintaks JS
npm run validate

# Jalankan seluruh unit test
npm test

# Buat file ZIP siap distribusi di folder dist/
npm run zip

# Generate ulang ikon PNG (opsional, membutuhkan Python 3)
npm run icons
```

### Membuat GitHub Release Otomatis
Workflow [.github/workflows/release.yml](.github/workflows/release.yml) akan otomatis memvalidasi, menjalankan tes, mem-package `.zip`, dan menerbitkan GitHub Release saat tag versi di-push:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## Catatan & Peringatan Keamanan

- **Batas Keamanan Browser**: Ekstensi Chrome hanya dapat mengklik pop-up/kartu konfirmasi berbasis halaman web (DOM/modal/Shadow DOM) dari Muse AI. Dialog izin sistem bawaan Chrome sendiri (seperti prompt kamera/mikrofon/notifikasi di bawah address bar) tidak dapat diklik oleh ekstensi—atur sekali melalui `chrome://settings/content`.
- **Gunakan Secara Bijak**: Mengotomatiskan persetujuan mengurangi pemeriksaan manual (*human-in-the-loop*). Pertahankan **Mode Aman (Safe Mode)** tetap aktif agar transaksi pembayaran, penghapusan data permanen, atau aksi sensitif tetap meminta konfirmasi Anda.

## Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).
