# Changelog

Semua perubahan penting pada proyek ini dicatat di file ini.

## [1.0.0] - 2026-11-26

### Added
- Rilis perdana ekstensi Google Chrome **Muse AI Auto-Allow** (Manifest V3).
- Deteksi otomatis pop-up konfirmasi Muse AI pada `muse.ai`, `muse.meta.com`, dan `meta.ai` (termasuk dukungan iframe dan Shadow DOM).
- Dukungan aktivasi domain kustom melalui `optional_host_permissions` dengan verifikasi konteks Muse.
- Pengaturan prioritas tombol (`Allow / Allow once` vs `Always allow`), jeda klik (`0–5000 ms`), dan label tombol kustom.
- **Mode Aman (Safe Mode)** untuk melewati pop-up sensitif (pembayaran, transfer, hapus akun, kata sandi) dengan daftar kata kunci yang dapat diubah.
- Popup panel kontrol dengan dukungan light/dark mode sistem, penghitung klik harian/total, notifikasi toast di halaman, dan riwayat aktivitas.
- Unit test otomatis (`tests/matcher.test.mjs`), skrip validasi (`scripts/validate.mjs`), dan bundler ZIP rilis (`scripts/package.mjs`).
