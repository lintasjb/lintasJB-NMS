# Menjalankan lintasJB NMS di aaPanel

Panduan ini untuk aaPanel v7+ di Linux (Ubuntu/Debian/AlmaLinux/Rocky).
Aplikasi **tidak butuh MySQL/PostgreSQL, Docker, atau build step** — hanya Node.js
dan satu folder `data/` yang writable.

---

## Ringkasan kebutuhan

| Item | Nilai |
| --- | --- |
| Node.js | **20 LTS** (minimum 18.17) |
| Port internal aplikasi | `8787` (bisa diubah di `.env`) |
| Database | JSON lokal di `data/db.json` |
| Build step | Tidak ada (`node server/index.js`) |
| Domain + SSL | Disarankan (wajib untuk fitur “Lokasi Saya”) |
| Port publik | Hanya `80` dan `443`. Port `8787` jangan dibuka ke publik. |

---

## 1. Install Node.js di aaPanel

1. Buka **App Store → Node.js Manager** (jika belum ada, install dulu).
2. Install **Node.js 20 LTS**.
3. Pastikan dari SSH:

```bash
node -v    # harus v18.17+ / v20.x
npm -v
```

Jika `node` belum ada di PATH, gunakan path dari Node.js Manager
(mis. `/www/server/nodejs/v20.x.x/bin/node`) atau set default version di panel.

---

## 2. Upload project

**Cara A — File Manager (paling mudah)**

1. Di komputer, zip folder project **tanpa** `node_modules` (dan tanpa `data/`
   jika ingin mulai bersih).
2. aaPanel → **Files** → `/www/wwwroot` → **Upload** → Extract.
3. Pastikan foldernya menjadi `/www/wwwroot/lintasjb-nms` (berisi `package.json`,
   `server/`, `public/`).

**Cara B — Git / SSH**

```bash
cd /www/wwwroot
git clone <URL-REPO-ANDA> lintasjb-nms
```

Lalu siapkan dependency dan permission:

```bash
cd /www/wwwroot/lintasjb-nms
npm install --omit=dev
mkdir -p data/uploads
chown -R www:www /www/wwwroot/lintasjb-nms
chmod -R u+rwX data
```

> `bcryptjs` adalah JavaScript murni, jadi tidak perlu compiler/build tools.

---

## 3. Buat file `.env`

```bash
cd /www/wwwroot/lintasjb-nms
cp .env.example .env
nano .env
```

Isi minimal:

```ini
PORT=8787
DATA_DIR=/www/wwwroot/lintasjb-nms/data
```

Catatan:

- **`DATA_DIR` sebaiknya absolut.** Secara default aplikasi memakai
  `process.cwd()/data`, jadi proses harus dijalankan dengan working directory
  di root project.
- `JWT_SECRET`, `LICENSE_SECRET`, dan `ENCRYPTION_KEY` boleh dikosongkan —
  dibuat otomatis di `data/secrets.json`. **Jangan hapus file itu**; jika hilang,
  semua sesi login dan kunci lisensi lama menjadi tidak valid.
- Jangan commit `.env` dan `data/` ke Git.

---

## 4. Jalankan aplikasi

### Opsi A — Node Project Manager aaPanel (GUI, disarankan)

1. aaPanel → **Website → Node Project → Add Node Project**.
2. Isi:
   - **Project name**: `lintasjb-nms`
   - **Project directory**: `/www/wwwroot/lintasjb-nms`
   - **Startup file / Run command**: `server/index.js`
     (atau `node server/index.js`)
   - **Port**: `8787`
   - **Node version**: `20.x`
   - **User**: `www`
3. Klik **Start**, lalu aktifkan **Auto start**.
4. Cek:

```bash
curl http://127.0.0.1:8787/api/health
```

### Opsi B — PM2 via SSH

```bash
npm install -g pm2
cd /www/wwwroot/lintasjb-nms
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
# jalankan perintah sudo yang dicetak pm2, contoh:
# sudo env PATH=$PATH:/www/server/nodejs/v20/bin pm2 startup systemd -u www --hp /home/www
```

Perintah harian:

```bash
pm2 status
pm2 logs lintasjb-nms
pm2 restart lintasjb-nms
```

> Gunakan **1 instance** (fork), bukan cluster — aplikasi memakai store JSON
> in-process dan SSE.

---

## 5. Domain, reverse proxy, dan SSL

1. **Website → Add site**: masukkan domain, pilih **PHP: static / pure HTML**
   (tidak perlu PHP).
2. Buka site → **SSL → Let's Encrypt** → Apply, lalu aktifkan **Force HTTPS**.
   Fitur geolocation browser hanya berjalan di HTTPS (atau localhost).
3. Buka **Reverse Proxy → Add reverse proxy**:
   - Target URL: `http://127.0.0.1:8787`
   - Cache: **off**
4. Edit config website (**Config**) dan tambahkan konfigurasi dari
   `deploy/nginx-lintasjb.conf` (terutama blok `/api/events`) sebelum
   `location /`, lalu **Save** dan reload Nginx.

Yang paling penting untuk realtime:

```nginx
location ^~ /api/events {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 24h;
}
```

Jangan lupa `client_max_body_size 30m;` agar import KML/KMZ/logo tidak gagal.

---

## 6. Firewall

- Buka hanya **80** dan **443** (aaPanel Firewall + Security Group cloud/VPS).
- **Jangan** membuka `8787` ke internet. Cukup `127.0.0.1`.
- Jika memakai Cloudflare, aktifkan **Full (strict)** setelah SSL aaPanel aktif;
  jangan mode “Flexible”.

---

## 7. Login pertama & keamanan

Buka `https://domain-anda/` lalu login:

```
Email    : admin@lintasjb.id
Password : Admin123!
```

Segera lakukan:

1. **Pengaturan → Akun Saya** → ganti password.
2. **Pengaturan → Pengguna**: nonaktifkan/hapus akun demo
   (`operator@lintasjb.id`) bila tidak dipakai, atau ganti password-nya.
3. **Pengaturan → Lisensi**: aktivasi lisensi produksi.
4. **Pengaturan → Branding**: ganti nama, logo, dan kontak perusahaan.
5. Backup `data/secrets.json` di tempat aman.

---

## 8. Integrasi perangkat

Semua konfigurasi GenieACS, OLT, dan MikroTik dilakukan dari UI
(**Perangkat → Integrasi**), bukan dari `.env`. Pastikan server aaPanel bisa
menjangkau perangkat:

| Integrasi | Port umum |
| --- | --- |
| GenieACS NBI | `7557` |
| OLT HiOSO web UI | `80` / `8080` |
| SNMP OLT | `161/udp` |
| MikroTik RouterOS API | `8728` / `8729` |
| MikroTik REST (v7) | `443` / `80` |

Jika perangkat berada di jaringan kantor, gunakan VPN/WireGuard atau
IP publik yang dibatasi firewall.

---

## 9. Backup

Seluruh state aplikasi ada di folder `data/`:

```
data/db.json        # semua project, node, kabel, user, tagihan
data/secrets.json   # JWT + license + encryption key (JANGAN hilang)
data/uploads/       # logo & file import
```

Backup harian dengan aaPanel **Cron**:

```bash
tar -czf /www/backup/lintasjb-$(date +%F).tar.gz \
  -C /www/wwwroot/lintasjb-nms data
```

Simpan juga salinan `secrets.json` terpisah. Untuk restore: hentikan aplikasi,
kembalikan folder `data/`, `chown -R www:www data`, lalu start lagi.

---

## 10. Update aplikasi

```bash
pm2 stop lintasjb-nms                     # atau Stop di Node Project Manager
cp -a /www/wwwroot/lintasjb-nms/data /www/backup/lintasjb-data-$(date +%F)
cd /www/wwwroot/lintasjb-nms
# git pull / upload file baru
npm install --omit=dev
chown -R www:www .
pm2 start lintasjb-nms
```

Tidak ada migrasi database manual; store akan menambahkan field baru otomatis.

---

## Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| **502 Bad Gateway** | Proses Node mati atau port beda. Cek `pm2 logs lintasjb-nms`, pastikan `PORT=8787` sama dengan target reverse proxy. |
| **Realtime/alarm tidak update** | Nginx mem-buffer SSE. Pastikan blok `/api/events` memakai `proxy_buffering off` dan `proxy_read_timeout` panjang. Cek tab Network browser untuk `/api/events` (harus `200`, tipe `text/event-stream`). |
| **Upload 25 MB gagal / 413** | Tambahkan `client_max_body_size 30m;` di server block. |
| **EACCES / gagal simpan data** | `chown -R www:www /www/wwwroot/lintasjb-nms` dan `chmod -R u+rwX data`. |
| **EADDRINUSE** | Port 8787 terpakai. Ganti `PORT` di `.env`, restart, sesuaikan reverse proxy. |
| **Peta kosong** | Server/browser tidak bisa mengakses tile OpenStreetMap/Carto. Cek koneksi keluar atau gunakan basemap kustom. |
| **“Lokasi Saya” tidak muncul** | Browser hanya mengizinkan geolocation pada HTTPS. Aktifkan SSL + Force HTTPS. |
| **Login kembali ke halaman masuk setelah restart** | `data/secrets.json` hilang/tertimpa. Jangan regenerasi secrets saat produksi; restore dari backup. |
| **QRIS tidak tampil (401)** | Sesi login kedaluwarsa. Login ulang lalu buka invoice. |
| **Node version error** | Gunakan Node 20; set versi di Node Project Manager / `pm2` PATH. |

---

## Checklist cepat

- [ ] Node.js 20 terpasang
- [ ] Project di `/www/wwwroot/lintasjb-nms`
- [ ] `npm install --omit=dev` sukses
- [ ] `.env` berisi `PORT` dan `DATA_DIR` absolut
- [ ] `data/` writable oleh user `www`
- [ ] Proses jalan, `curl 127.0.0.1:8787/api/health` OK
- [ ] Domain + SSL + Force HTTPS
- [ ] Reverse proxy ke `127.0.0.1:8787`
- [ ] Blok `/api/events` tanpa buffering
- [ ] `client_max_body_size 30m`
- [ ] Password admin diganti
- [ ] Backup `data/` terjadwal
