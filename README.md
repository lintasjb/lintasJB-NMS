# lintasJB NMS

**Fiber Network Intelligence** — aplikasi pemetaan dan monitoring jaringan FTTH self-hosted.
Menggabungkan peta interaktif, manajemen aset, POSGIS fault locator, GenieACS, OLT HiOSO/multi-vendor,
dan MikroTik RouterOS dalam satu dashboard realtime.

![status](https://img.shields.io/badge/status-production--ready-22d3ee)
![node](https://img.shields.io/badge/node-%3E%3D18.17-a3e635)

---

## Daftar isi

1. [Fitur](#fitur)
2. [Arsitektur](#arsitektur)
3. [Menjalankan aplikasi](#menjalankan-aplikasi)
4. [Akun demo](#akun-demo)
5. [Konfigurasi](#konfigurasi)
6. [Integrasi perangkat](#integrasi-perangkat)
7. [POSGIS fault locator](#posgis-fault-locator)
8. [Import / export](#import--export)
9. [Lisensi](#lisensi)
10. [Admin Panel](#admin-panel)
11. [Struktur project](#struktur-project)
12. [API ringkas](#api-ringkas)
13. [Troubleshooting](#troubleshooting)

---

## Fitur

### Peta & visualisasi
- **Live Map** Leaflet dengan 10 pilihan basemap (Esri Dark/Light/Imagery/Topo/Street/National
  Geographic, OpenStreetMap, OpenTopoMap, Humanitarian, kanvas kosong) dan dukungan tile kustom.
- Basemap bawaan memakai penyedia **tanpa API key**; id Carto lama dimigrasikan otomatis agar
  peta tidak lagi menampilkan watermark “API KEY REQUIRED”.
- **Animasi aliran kabel** per tipe (backbone, feeder, distribusi, drop) dengan warna, kecepatan,
  arah, dan 13 pola animasi: `flow`, `glowflow` (aliran bercahaya), `comet`, `packet`, `wave`,
  `laser`, `rainbow`, `pulse`, `dash`, `glow`, `breath`, `static`, dan `none`.
- **Node** POP site, router, server, OLT, ODC, ODP, ONT, dan joint closure.
- **Rute kabel** dengan gambar polyline di peta, panjang geodesic otomatis, jumlah core, dan utilisasi.
- Marker gangguan berdenyut, overlay peringatan, sorotan kabel putus, dan efek suara alarm.
- **Lokasi saya** (geolocation), ambil titik koordinat, pencarian global `Ctrl+K`, dan mode layar penuh.
- Pilihan layer per tipe node/kabel, label node, dan marker gangguan.

### Operasional
- **POSGIS fault locator**: konversi jarak OTDR (meter/km) atau persentase kabel menjadi koordinat
  titik putus, plus daftar node terdampak dan pembuatan gangguan + alarm otomatis.
- **Alarm center** realtime (SSE) dengan acknowledge, resolve, dan riwayat.
- **Simulasi gangguan** kabel/perangkat untuk validasi alarm dan animasi.
- **Monitor otomatis** berkala untuk GenieACS, OLT, dan router; deteksi ONT offline dan pembuatan
  fault kabel downstream.
- **Perangkat**: GenieACS NBI (TR-069/CWMP), OLT HiOSO (simulasi / HTTP web UI / SNMP), dan
  MikroTik RouterOS (REST API v7 atau API native, termasuk self-signed TLS).
- **Manajemen project** multi-tenant: setiap project punya node, kabel, gangguan, dan riwayat sendiri.

### Data & administrasi
- Import/export **KML, KMZ, GeoJSON, CSV** (node dan kabel) dengan pratinjau dry-run.
- Branding perusahaan: nama, tagline, logo upload, warna aksen, favicon.
- Lisensi kustom HMAC dengan trial 30 hari, aktivasi, dan generator kunci.
- **Pembelian lisensi** dengan harga kustom dan 14 metode pembayaran: QRIS (QR EMVCo),
  transfer BCA/BNI/BRI/Mandiri, virtual account, GoPay/OVO/DANA/ShopeePay, serta Alfamart/Indomaret.
  Admin memverifikasi pembayaran lalu lisensi dibuat dan diaktifkan otomatis.
- **Halaman Tentang** (`#/about`): deskripsi produk, modul, teknologi, runtime server, status lisensi,
  kontak, kredit, pintasan keyboard, dan tombol salin info sistem.
- Semua kolom input memakai tema gelap yang konsisten (termasuk autofill Chrome/Edge).
- Manajemen pengguna (superadmin/admin/operator/viewer), profil, dan ganti password.
- **Pemisahan project per akun**: akun hanya melihat project buatannya; superadmin melihat
  seluruh project; akun demo khusus hanya project simulasi bersifat hanya-baca.
- **Admin Panel** (`#/admin`) khusus superadmin/admin: ringkasan sistem, pengguna & role,
  project, log aktivitas, integrasi & lisensi, harga paket Rupiah, dan unduh backup.
- Audit log aktivitas dan riwayat import/export.
- Database JSON lokal (tanpa PostgreSQL/Docker) + backup mudah.
- Tema gelap responsif untuk desktop dan mobile.

---

## Arsitektur

```
Browser (Vanilla JS SPA + Leaflet)
        │  fetch / SSE
        ▼
Express API (Node.js ESM)
        ├── data/db.json          ← database JSON atomik
        ├── data/uploads/         ← logo & file import
        ├── data/secrets.json     ← JWT / license / encryption key
        ├── server/adapters/      ← GenieACS, HiOSO, MikroTik
        └── server/lib/           ← auth, POSGIS, fault engine, SNMP
```

- **Backend**: Node.js + Express, ES modules, tanpa build step.
- **Frontend**: ES modules native, hash router, Leaflet dari `public/vendor`.
- **Realtime**: Server-Sent Events pada `/api/events`.
- **Penyimpanan**: JSON store dengan penulisan atomik (`data/db.json`).

---

## Menjalankan aplikasi

### Prasyarat
- **Node.js 18.17+** (disarankan 20/22). Tidak perlu Docker atau PostgreSQL.
- Port default **8787** (dapat diubah lewat `PORT`).

### Instalasi

```bash
cd lintasjb-nms
npm install
npm start
```

Buka <http://localhost:8787>.

### Windows

Jalankan `start.bat` (akan memakai Node portable di `%TEMP%\node-portable` bila Node belum
terpasang, lalu `npm install` otomatis pada run pertama).

### Mode development

```bash
npm run dev     # node --watch, reload otomatis saat file server berubah
```

> Catatan: port 3000 sering dipakai aplikasi lain (legacy Docker). Default proyek ini 8787 agar aman.

---

## Akun demo

| Role | Email | Password | Keterangan |
| --- | --- | --- | --- |
| Superadmin | `admin@lintasjb.id` | `Admin123!` | Melihat seluruh project |
| Operator | `operator@lintasjb.id` | `Operator123!` | Hanya project yang dibuatnya sendiri |
| Demo | `demo@lintasjb.id` | `Demo123!` | Hanya project simulasi, **hanya-baca** |

Tombol **Isi akun demo / Login demo** di halaman masuk memakai akun demo (`viewer`).
Akun demo hanya melihat project bertanda simulasi, hanya perangkat mode simulasi, dan
semua aksi tulis ditolak (`403`). Data demo berisi 2 project di koridor Jember–Banyuwangi
(20 node, 17 kabel, 2 OLT HiOSO, 2 router MikroTik). Registrasi baru otomatis membuat
project sendiri dan dapat menyalin data demo.

### Visibilitas project

- **Superadmin** melihat seluruh project, termasuk project milik akun lain.
- **Admin** dan **operator** hanya melihat project yang mereka buat sendiri (`createdBy`).
- **Akun demo** hanya melihat project simulasi (`demo: true`) dan perangkat `simulated`.
- Project milik akun lain tidak bisa diakses lewat `?projectId=` maupun endpoint berbasis
  `:id` (node, kabel, gangguan, alarm, OLT, router): server mengembalikan `403`.
- Event realtime (SSE) juga difilter per akun agar data project lain tidak ikut terkirim.

---

## Konfigurasi

Salin `.env.example` menjadi `.env` bila perlu:

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `8787` | Port HTTP |
| `DATA_DIR` | `./data` | Lokasi database, upload, dan secrets |
| `JWT_SECRET` | acak (tersimpan) | Secret token login; isi untuk deployment terkontrol |
| `LICENSE_SECRET` | acak (tersimpan) | Secret HMAC lisensi |
| `ENCRYPTION_KEY` | acak (tersimpan) | Kunci enkripsi kredensial integrasi (AES-256-GCM) |
| `WEBHOOK_STRICT` | `0` | `1` = wajibkan token webhook GenieACS |

Jika tidak diisi, secret dibuat otomatis di `data/secrets.json` dan dipertahankan antar-restart.
**Jangan commit** folder `data/`.

### Backup

Cukup salin folder `data/` (atau `DATA_DIR`) saat aplikasi berhenti:

```bash
tar -czf lintasjb-backup-$(date +%F).tar.gz data/
```

---

## Integrasi perangkat

### GenieACS (TR-069 / CWMP)
1. Buka **Pengaturan → Integrasi**.
2. Isi URL NBI (default `http://127.0.0.1:7557`), username/password bila ada.
3. Aktifkan GenieACS, simpan, lalu **Tes koneksi** / **Sync ONT** di halaman **Perangkat**.

Kredensial disimpan terenkripsi (AES-256-GCM) di database. Webhook eksternal tersedia lewat
token di halaman Monitor.

### OLT HiOSO / multi-vendor
- **Mode simulasi** aktif secara default untuk demo tanpa perangkat fisik (tidak dihapus).
- **HTTP web UI**: isi host/port, kredensial, dan path endpoint ONU sesuai firmware.
  Untuk **HiOSO HA7304/FHA7104 (GoAhead EPON)** gunakan port manajemen web
  (umumnya **8180**), biarkan **Login path** kosong untuk HTTP Basic auth, dan isi
  **ONU list path** `/onuAllPonOnuList.asp`. Halaman ini menyematkan seluruh daftar ONU
  sebagai array JavaScript; adapter mem-parsing id/port, nama, MAC, status, Tx/Rx, suhu,
  dan jarak tanpa perlu login form.
- **SNMP**: isi community, port 161, dan OID bila tersedia. Adapter mencoba SNMP sebelum fallback.
- **SSH (remote CLI)**: pilih protokol **SSH**, port default 22, lalu isi username/password
  atau private key (disimpan terenkripsi). Sesuaikan **Perintah tes** dan **Perintah ONU**
  dengan firmware OLT, mis. `display ont info 0 all` (Huawei), `show gpon onu state` (ZTE),
  atau `show onu all` (HiOSO/FiberHome). Adapter membuka shell SSH, menangani prompt
  `--More--`, dan mem-parsing serial/status/RX/jarak dari output CLI.
- Tombol **Test Connection** di form menampilkan latensi + identitas sebelum disimpan.
  Setelah tersimpan, tombol **Remote SSH** di kartu OLT membuka terminal untuk menjalankan
  perintah CLI langsung (setiap perintah dicatat di aktivitas).
- Aksi lain: daftar ONU, sync ONT baru, dan monitoring otomatis.

### MikroTik RouterOS
- Integrasi memakai koneksi **nyata** ke router (tanpa mode simulasi).
- **API biner (api)**: untuk RouterOS v6/v7 dengan service `api` (8728) atau `api-ssl` (8729).
  Port NAT bebas (mis. 8782 → 8728) karena adapter mendeteksi protokol otomatis.
- **REST API**: aktifkan `www-ssl` (RouterOS v7) atau `www`, isi host/port (default 443),
  username, password, dan biarkan skema `https` untuk sertifikat self-signed.
- **Password Env** (opsional): isi nama environment variable (mis. `MIKROTIK_002_PASSWORD`)
  bila password tidak ingin disimpan di database. Nilai env dipakai lebih dulu bila tersedia.
- Tombol **Test Connection** di form menampilkan latensi dan identitas router sebelum disimpan.
- Aksi lain: daftar interface, sesi PPPoE, dan sync status ke node site.

---

## POSGIS fault locator

POSGIS adalah engine geodesic lokal (tanpa dependensi PostGIS) yang:

1. Menghitung panjang polyline kabel dengan formula haversine.
2. Mencari titik pada jarak tertentu dari sisi A (atau persentase panjang kabel).
3. Menyimpan koordinat, jarak, kabel, dan node terdampak ke fault + alarm.
4. Menandai kabel `fault` dan node downstream `offline` sampai gangguan dipulihkan.

Input yang didukung: jarak OTDR (km), rasio 25/50/75/100%, atau catatan lapangan.
Skema SQL opsional untuk analitik PostGIS tersedia di [`docs/postgis.sql`](docs/postgis.sql).

---

## Import / export

| Format | Arah | Isi |
| --- | --- | --- |
| KML | import/export | Placemark Point = node, LineString = kabel |
| KMZ | import/export | KML terkompresi (`doc.kml`) |
| GeoJSON | import/export | FeatureCollection Point/LineString |
| CSV node | import/export/template | `name, code, type, status, lat, lng, address, serial, ...` |
| CSV kabel | export | rute, tipe, core, status |

- Pratinjau **dry-run** menampilkan jumlah node/kabel dan peringatan sebelum import.
- Koordinat wajib **WGS84** (`latitude, longitude`).
- Kabel otomatis mencari node terdekat (radius 80 m) sebagai ujung rute.
- Batas upload 25 MB per file.

---

## Lisensi

- Setiap instalasi memakai **trial 30 hari** dengan kuota node.
- Lisensi kustom ditandatangani **HMAC-SHA256** dan diikat ke `instanceId`.
- **Pengaturan → Lisensi** menampilkan status, sisa hari, kuota, aktivasi, dan generator kunci
  (untuk penerbitan internal).
- **Beli / perpanjang lisensi** tersedia di tab yang sama:
  - Nama pelanggan, email, WhatsApp, paket, masa berlaku, dan kuota node.
  - **Harga kustom** (minimal Rp 10.000) + tombol harga cepat per paket.
  - Metode pembayaran: QRIS, transfer bank, virtual account, e-wallet, dan gerai retail.
  - Biaya layanan dihitung server (persen untuk QRIS/e-wallet, flat untuk VA/retail).
  - Invoice 24 jam berisi kode bayar / nomor VA / QR PNG, instruksi, dan riwayat tagihan.
  - Admin dapat **memverifikasi pembayaran** (lisensi langsung dibuat & diaktifkan) atau membatalkan tagihan.
  - Data merchant, rekening, dan nomor e-wallet dapat diubah dari panel admin di tab lisensi.
- Kunci lisensi berbentuk `LJB-...` dan diverifikasi sepenuhnya offline di server.

---

## Admin Panel

Halaman khusus administrator di `#/admin` (menu sidebar **Admin Panel**, hanya tampil untuk
`superadmin` dan `admin`). Tab yang tersedia:

| Tab | Isi |
| --- | --- |
| **Ringkasan** | Uptime, memori, jumlah pengguna/project/node, status monitor, integrasi, lisensi, aktivitas terakhir |
| **Pengguna & Role** | Cari/filter, tambah akun, ubah role/status, reset password, hapus akun |
| **Project** | Buka, buat, duplikasi, dan hapus project beserta topologinya |
| **Log Aktivitas** | Audit login, CRUD, integrasi, lisensi, dan tindakan admin (filter + paging) |
| **Integrasi & Lisensi** | Status GenieACS, OLT, MikroTik, dan pemakaian kuota lisensi |
| **Harga & Paket** | Harga bulanan/tahunan dalam **Rupiah**; hanya superadmin yang dapat mengubah |
| **Backup Data** | Unduh `db.json` (khusus superadmin) + panduan restore |

Batasan akses:

- `admin` dapat mengelola pengguna non-superadmin, tetapi tidak dapat membuat/mengubah akun
  superadmin, mengubah harga, atau mengunduh backup.
- `operator`/`viewer` tidak melihat menu Admin Panel dan mendapat `403` dari API admin.
- Harga tersimpan di `settings.pricing` (`{ currency: 'IDR', plans: [...] }`) dan dipakai oleh
  `/api/billing/config` untuk daftar paket, kuota node, harga cepat bulanan/tahunan, dan nominal
  awal pada form pembelian lisensi. Perubahan langsung tampil tanpa mengubah kode.

Contoh endpoint:

```
GET  /api/admin/overview        # ringkasan sistem
GET  /api/admin/activity        # ?q=&action=&userId=&limit=&offset=
GET  /api/admin/pricing
PUT  /api/admin/pricing         # superadmin
GET  /api/admin/backup          # superadmin, download db.json
POST /api/auth/users            # tambah pengguna
POST /api/auth/users/:id/password
```

---

## Struktur project

```
lintasjb-nms/
├── server/
│   ├── index.js              # Express app, SSE, static, error handler
│   ├── seed.js               # data demo Jember–Banyuwangi
│   ├── monitors.js           # polling otomatis perangkat
│   ├── basemaps.js           # katalog basemap
│   ├── adapters/             # genieacs.js, hioso.js, mikrotik.js
│   ├── lib/                  # auth, store, geo, faults, license, billing, pricing, ...
│   └── routes/               # auth, network, settings, integrations, io, billing, admin
├── public/
│   ├── index.html            # shell SPA + sprite ikon
│   ├── css/app.css           # design system
│   ├── assets/lintasjb-mark.png   # mark perusahaan (default)
│   ├── assets/lintasjb-logo-full.png # logo lengkap (halaman login)
│   ├── vendor/leaflet/       # Leaflet lokal
│   └── js/
│       ├── app.js            # bootstrap, auth, shell, SSE, palette
│       ├── api.js            # API client + SSE
│       ├── map.js            # engine Leaflet
│       ├── forms.js          # modal CRUD node/kabel + drawer
│       ├── pages/            # dashboard, map, assets, cables, about, ...
│       └── ...
├── docs/postgis.sql          # skema PostGIS opsional
├── data/                     # dibuat otomatis (db, upload, secrets)
├── .env.example
├── start.bat
└── package.json
```

---

## API ringkas

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Login, mengembalikan JWT 7 hari |
| `POST` | `/api/auth/register` | Registrasi + project baru |
| `GET` | `/api/bootstrap?projectId=` | Semua data awal aplikasi |
| `GET/POST` | `/api/nodes`, `/api/cables` | CRUD aset |
| `POST` | `/api/faults/locate` | POSGIS: jarak/rasio → fault |
| `POST` | `/api/faults/:id/repair` | Pulihkan gangguan |
| `POST` | `/api/alarms/:id/ack` | Acknowledge alarm |
| `GET` | `/api/io/export?format=kml` | Export project |
| `POST` | `/api/io/import` | Import multipart (`file`, `dryRun`) |
| `POST` | `/api/olts/:id/test` | Tes OLT |
| `POST` | `/api/olts/test-connection` | Tes OLT dari form (sebelum simpan) |
| `POST` | `/api/olts/:id/exec` | Remote perintah CLI via SSH |
| `POST` | `/api/routers/test-connection` | Tes koneksi router dari form (sebelum simpan) |
| `POST` | `/api/routers/:id/test` | Tes RouterOS |
| `GET` | `/api/about` | Info aplikasi, runtime, statistik, lisensi |
| `GET` | `/api/billing/config` | Metode bayar, harga, riwayat tagihan |
| `POST` | `/api/billing/orders` | Buat tagihan lisensi (harga kustom) |
| `GET` | `/api/billing/orders/:id/qr.png` | QRIS PNG (token via `?token=`) |
| `POST` | `/api/billing/orders/:id/pay` | Admin verifikasi pembayaran |
| `POST` | `/api/billing/orders/:id/cancel` | Batalkan tagihan |
| `GET` | `/api/admin/overview` | Ringkasan sistem (superadmin/admin) |
| `GET` | `/api/admin/activity` | Log aktivitas + filter (superadmin/admin) |
| `GET/PUT` | `/api/admin/pricing` | Harga paket Rupiah (PUT: superadmin) |
| `GET` | `/api/admin/backup` | Unduh `db.json` (superadmin) |
| `POST` | `/api/auth/users` | Tambah pengguna (superadmin/admin) |
| `POST` | `/api/auth/users/:id/password` | Reset password pengguna |
| `GET` | `/api/events` | SSE realtime |
| `GET` | `/api/health` | Health check publik |

Semua endpoint selain health/login/register memerlukan header `Authorization: Bearer <token>`.
Untuk akun non-superadmin, endpoint project dan data (node, kabel, fault, alarm, OLT, router)
hanya mengembalikan konten project milik sendiri; akun demo memakai project simulasi dan
menolak semua operasi tulis dengan `403`.

---

## Troubleshooting

| Gejala | Solusi |
| --- | --- |
| `EADDRINUSE` | Port terpakai. Set `PORT=8788` di `.env` atau hentikan proses lain. |
| Login selalu kembali ke halaman masuk | Token kedaluwarsa/secret berubah. Login ulang. Jangan hapus `data/secrets.json` saat aplikasi berjalan. |
| Peta kosong | Periksa koneksi tile internet atau pilih basemap **Kanvas Kosong** untuk mode offline. |
| GenieACS `ECONNREFUSED` | NBI belum berjalan di port 7557 atau URL salah. |
| MikroTik TLS error | Aktifkan *allow self-signed* atau pasang sertifikat yang dipercaya. |
| OLT tidak terbaca | Cek mode (simulasi/HTTP/SNMP), kredensial, dan akses port 80/8180/161. |
| File import ditolak | Pastikan ekstensi KML/KMZ/GeoJSON/CSV, ukuran < 25 MB, koordinat WGS84. |
| Data hilang setelah restart | Pastikan `DATA_DIR` konsisten dan folder `data/` dapat ditulis. |

Log server tampil di terminal. Untuk produksi, jalankan di balik reverse proxy (Nginx/Caddy)
dengan HTTPS dan aktifkan `trust proxy` (sudah disetel).

---

© lintasJB — PT Lintas Jaringan Bersama. Lisensi kustom, self-hosted.
