# Panduan Lengkap Setup dan Pengoperasian Sistem ticket-in
## Dokumentasi Step-by-Step Instalasi, Konfigurasi Pihak Ketiga, Migrasi, dan Eksekusi

Dokumen ini merupakan panduan resmi langkah demi langkah (step-by-step) untuk melakukan instalasi, konfigurasi infrastruktur pihak ketiga (PostgreSQL, Redis, Kafka KRaft, Toxiproxy, Prometheus, Grafana), migrasi basis data, menjalankan 3 proses utama aplikasi (`api`, `worker`, `payment-simulator`), serta melakukan pengujian beban dan verifikasi sistem.

---

## 1. Prasyarat Sistem (Prerequisites)

Sebelum memulai proses instalasi, pastikan sistem operasi Anda (Windows 11 / 10 dengan WSL2, atau Linux Ubuntu 22.04+) telah terpasang perangkat lunak berikut:

| Perangkat Lunak | Versi Minimal | Fungsi Utama | Cara Pengecekan |
|---|---|---|---|
| Node.js | >= 22.0.0 LTS | Lingkungan runtime JavaScript / TypeScript | `node -v` |
| pnpm | >= 9.0.0 | Package manager utama (wajib, pengganti npm/yarn) | `pnpm -v` |
| Docker & Docker Compose | v24.0+ (Compose v2) | Orkestrasi kontainer layanan pihak ketiga | `docker -v`, `docker compose version` |
| Git | >= 2.40 | Kontrol versi dengan normalisasi line-ending LF | `git --version` |

### 1.1. Panduan Pemasangan pnpm di Windows dan Linux
Jika perintah `pnpm` belum dikenali di terminal Anda:

- **Opsi A: Menggunakan Corepack (Bawaan Node.js - Direkomendasikan)**:
  ```powershell
  # Jalankan di PowerShell dengan hak Administrator jika diperlukan
  corepack enable
  corepack prepare pnpm@latest --activate
  ```

- **Opsi B: Menggunakan npm global**:
  ```bash
  npm install -g pnpm
  ```

- **Catatan Windows PowerShell**: Jika muncul pesan kesalahan `running scripts is disabled on this system`, jalankan perintah berikut di PowerShell Administrator:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

---

## 2. Kloning Repositori dan Pengaturan Line Ending

Repositori ini menerapkan aturan ketat line ending `LF` (`\n`) untuk menjamin konsistensi lintas platform Windows dan Linux.

```bash
# 1. Kloning repositori
git clone <url-repositori> ticket-in
cd ticket-in

# 2. Pastikan konfigurasi git tidak mengubah LF menjadi CRLF pada Windows
git config core.autocrlf false
git config core.eol lf
```

---

## 3. Konfigurasi Variabel Lingkungan (.env)

Aplikasi membaca konfigurasi dari berkas `.env` pada root direktori. Berkas contoh telah disediakan di `.env.example`.

### 3.1. Salin Berkas Konfigurasi
- **Di Windows (PowerShell)**:
  ```powershell
  Copy-Item .env.example .env
  ```
- **Di Linux / macOS (Bash)**:
  ```bash
  cp .env.example .env
  ```

### 3.2. Penjelasan Rinci Setiap Variabel Lingkungan

| Variabel | Nilai Default | Penjelasan dan Fungsi |
|---|---|---|
| `NODE_ENV` | `development` | Lingkungan runtime (`development`, `production`, `test`) |
| `PORT` | `3000` | Port HTTP untuk server utama `api` |
| `HOST` | `0.0.0.0` | Host binding untuk server Fastify |
| `LOG_LEVEL` | `info` | Level verbositas logger Pino (`debug`, `info`, `warn`, `error`) |
| `DATABASE_URL` | `postgresql://ticketin:ticketin_dev_password@localhost:5432/ticketin_db` | Connection string PostgreSQL pihak ketiga |
| `DATABASE_MAX_CONNECTIONS` | `20` | Batas maksimum connection pool basis data per proses |
| `REDIS_URL` | `redis://:redis_dev_password@localhost:6379/0` | Connection string Redis (antrean ruang tunggu & hold TTL) |
| `KAFKA_BROKERS` | `localhost:9092` | Alamat broker Kafka KRaft pihak ketiga |
| `KAFKA_CLIENT_ID` | `ticket-in-service` | Identitas client Kafka untuk consumer group |
| `JWT_ACCESS_SECRET` | `dev_jwt_access_secret_key_minimum_32_chars_12345` | Kunci rahasia enkripsi JWT access token (minimal 32 karakter) |
| `JWT_REFRESH_SECRET` | `dev_jwt_refresh_secret_key_minimum_32_chars_12345` | Kunci rahasia enkripsi JWT refresh token (minimal 32 karakter) |
| `WAITING_ROOM_SECRET` | `dev_waiting_room_hmac_secret_key_minimum_32_chars` | Kunci HMAC penandatanganan admission token antrean |
| `WEBHOOK_HMAC_SECRET` | `dev_webhook_signature_hmac_secret_minimum_32_chars` | Kunci HMAC verifikasi webhook pembayaran simulator |
| `PAYMENT_SIMULATOR_PORT` | `3001` | Port HTTP untuk proses independen `payment-simulator` |
| `PAYMENT_SIMULATOR_URL` | `http://localhost:3001` | URL target untuk memicu permintaan pembayaran ke simulator |
| `PAYMENT_SIMULATOR_LATENCY_MS` | `300` | Latensi buatan simulator pembayaran (milidetik) |
| `PAYMENT_SIMULATOR_FAILURE_RATE` | `0.05` | Rasio kegagalan acak simulasi pembayaran (5%) |
| `ADMISSION_RATE_PER_INTERVAL` | `50` | Jumlah kuota token antrean yang diloloskan per interval |
| `ADMISSION_INTERVAL_MS` | `5000` | Interval pelepasan antrean ruang tunggu (5 detik) |
| `HEARTBEAT_TTL_SECONDS` | `30` | Batas waktu detak jantung (heartbeat) pengguna di ruang tunggu |

---

## 4. Instalasi Dependensi Proyek

Jalankan perintah instalasi menggunakan `pnpm`:

```bash
pnpm install --frozen-lockfile
```

Untuk memverifikasi bahwa seluruh tipe data TypeScript valid:
```bash
pnpm run typecheck
```

Untuk memverifikasi bahwa batasan arsitektur modular tidak dilanggar:
```bash
pnpm run depcruise
```

---

## 5. Menjalankan Layanan Infrastruktur Pihak Ketiga (Docker Compose)

ticket-in menggunakan arsitektur modular dengan layanan pendukung yang diisolasi ke dalam Docker Compose Profiles pada berkas `compose.yaml`.

### 5.1. Rincian Layanan Pihak Ketiga

1. **PostgreSQL 16 Alpine (`postgres`)**:
   - Port Host: `5432`
   - Database: `ticketin_db`
   - Kredensial: user `ticketin`, password `ticketin_dev_password`
   - Volume: `postgres_data`
   - Fungsi: Basis data transaksional ACID, baris inventaris tiket, partial unique index anti-overselling.

2. **Redis 7 Alpine (`redis`)**:
   - Port Host: `6379`
   - Password: `redis_dev_password`
   - Volume: `redis_data`
   - Fungsi: Rate limiter per IP, ruang tunggu virtual ZSET (FIFO), dan penyimpanan status hold kursi dengan TTL.

3. **Apache Kafka 3.8.0 KRaft Mode (`kafka`)**:
   - Port Host: `9092`
   - Mode: KRaft (Event-driven controller modern tanpa dependensi ZooKeeper)
   - Volume: `kafka_data`
   - Fungsi: Broker pesan untuk Transactional Outbox Pattern dan konsumsi asynchronous tiket digital.

4. **Toxiproxy 2.9.0 (`toxiproxy` - Profil Chaos)**:
   - Port Kontrol API: `8474`
   - Port Proxy: `25432` (Postgres), `26379` (Redis), `29092` (Kafka)
   - Fungsi: Injeksi kegagalan jaringan acak (jitter, latency, packet drop) untuk chaos testing.

5. **Prometheus v2.53.0 & Grafana 11.1.0 (`observability` - Profil Observability)**:
   - Port Prometheus: `9090`
   - Port Grafana: `3002` (di-map dari port internal 3000)
   - Kredensial Grafana: user `admin`, password `grafana_admin`
   - Fungsi: Scraping metrik Fastify, Redis, dan Kafka secara real-time.

### 5.2. Perintah Menjalankan Layanan Pihak Ketiga

#### Menjalankan Layanan Inti (Core Stack)
Ini adalah opsi minimal yang wajib dijalankan untuk pengembangan lokal sehari-hari:
```bash
docker compose --profile core up -d
```

#### Menjalankan Layanan Inti + Observability (Prometheus & Grafana)
Gunakan opsi ini jika ingin memantau metrik performa saat pengujian:
```bash
docker compose --profile core --profile observability up -d
```

#### Menjalankan Seluruh Profil (Core + Chaos + Observability)
```bash
docker compose --profile core --profile chaos --profile observability up -d
```

### 5.3. Verifikasi Status Kesehatan Kontainer
Pastikan seluruh kontainer berada dalam status `healthy`:
```bash
docker compose ps
```
Contoh output yang benar:
```text
NAME                 IMAGE                   STATUS                    PORTS
ticket-in-postgres   postgres:16-alpine      Up (healthy) 0.0.0.0:5432->5432/tcp
ticket-in-redis      redis:7-alpine          Up (healthy) 0.0.0.0:6379->6379/tcp
ticket-in-kafka      apache/kafka:3.8.0      Up (healthy) 0.0.0.0:9092->9092/tcp
```

---

## 6. Migrasi Skema Basis Data dan Seeding Data Uji

Setelah PostgreSQL berjalan, inisialisasi skema tabel dan isi data awal untuk pengujian.

### Langkah 6.1: Menjalankan Migrasi Skema (Drizzle ORM)
Perintah ini akan membuat ekstensi `pgcrypto` dan mengeksekusi berkas migrasi SQL pada folder `migrations/`:
```bash
pnpm run db:migrate
```

### Langkah 6.2: Seeding Data Uji (Master Event, Kategori, & Kursi)
Perintah ini akan memasukkan data simulasi konser konser besar serta akun pengguna default untuk pengujian:
```bash
pnpm run db:seed
```

#### Tabel Akun Pengguna Bawaan (Default Test Credentials):
| Email | Username | Password | Role | Peruntukan Uji |
|---|---|---|---|---|
| `admin@ticketin.internal` | `admin` | `AdminSecret123!` | `admin` | Akses penuh manajemen sistem & observability |
| `organizer@ticketin.internal` | `organizer` | `OrganizerSecret123!` | `organizer` | Pembuatan master event dan kategori tiket |
| `user1@ticketin.internal` | `user1` | `UserSecret123!` | `user` | Pembeli 1 simulasi perebutan tiket |
| `user2@ticketin.internal` | `user2` | `UserSecret123!` | `user` | Pembeli 2 simulasi perebutan tiket |

#### Data Master Konser yang Dihasilkan:
- **Nama Acara**: Sound of Future World Tour Jakarta 2026
- **Slug Acara**: `sound-of-future-jakarta-2026`
- **Total Kursi Bernomor**: 1.000 kursi terdistribusi ke dalam 3 kategori:
  - **VIP**: 100 kursi (`VIP-001` s/d `VIP-100`) harga Rp 1.500.000
  - **CAT 1**: 400 kursi (`CAT1-001` s/d `CAT1-400`) harga Rp 800.000
  - **CAT 2**: 500 kursi (`CAT2-001` s/d `CAT2-500`) harga Rp 400.000

### Langkah 6.3: Validasi Invarian Basis Data
Pastikan struktur database mematuhi seluruh invarian zero overselling:
```bash
pnpm run db:check-invariants
```

---

## 7. Menjalankan Tiga Proses Utama Aplikasi (Three-Process Topology)

Sistem `ticket-in` dibangun dengan topologi tiga proses terpisah yang berjalan dari satu basis kode (Modular Monolith). Untuk pengalaman pengembangan terbaik, buka 3 tab terminal terpisah.

### Terminal 1: Proses API Server (Fastify HTTP)
Menjalankan endpoint otentikasi, katalog event, ruang tunggu antrean, reservasi hold, pembuatan order, dan antarmuka web:
```bash
pnpm run dev:api
```
- Endpoint HTTP: `http://localhost:3000`
- Dokumentasi Interaktif Swagger UI: `http://localhost:3000/docs`
- Antarmuka Demonstrasi Web: `http://localhost:3000/`

### Terminal 2: Proses Payment Simulator (Gateway Pihak Ketiga)
Menjalankan mock server gateway pembayaran pihak ketiga yang bertugas menerima charge pembayaran, memicu latensi buatan, dan mengirim webhook ber-signature HMAC:
```bash
pnpm run dev:simulator
```
- Endpoint Simulator: `http://localhost:3001`
- Log aktivitas webhook dan HMAC signature akan tampil di terminal ini.

### Terminal 3: Proses Background Worker (Outbox & Sweeper)
Menjalankan consumer background untuk:
- Transactional Outbox processor (menerbitkan event pesanan ke Kafka).
- Sweeper pembersih kursi hold kedaluwarsa (mengembalikan kursi yang melewati TTL ke status AVAILABLE).
- Consumer event Kafka untuk menerbitkan tiket digital resmi:
```bash
pnpm run dev:worker
```

---

## 8. Verifikasi End-to-End Melalui Antarmuka Pengguna (Web Demo)

Setelah ketiga proses berjalan:

1. Buka peramban (browser) dan akses:
   ```text
   http://localhost:3000/
   ```
2. Anda akan disajikan antarmuka single-file demonstrasi interaktif `public/index.html` yang mencakup:
   - Status antrean Ruang Tunggu (Waiting Room) secara live.
   - Peta denah kursi interaktif (Seat Map) dengan visualisasi status kursi (Available, Holding, Reserved).
   - Panel simulasi Ticket War untuk menguji perebutan kursi secara serentak.
   - Panel riwayat pembayaran dan tiket digital hasil konfirmasi webhook.

3. Akses Dokumentasi OpenAPI / Swagger:
   ```text
   http://localhost:3000/docs
   ```
   Gunakan halaman ini untuk menguji API secara manual (misalnya endpoint `/api/v1/auth/login`, `/api/v1/queue/join`, `/api/v1/reservations/hold`).

4. Akses Dasbor Observability (jika profil diaktifkan):
   - **Grafana**: `http://localhost:3002` (Login: `admin` / `grafana_admin`).
   - **Prometheus**: `http://localhost:9090` (Kueri metrik Fastify seperti `http_request_duration_seconds`).

---

## 9. Menjalankan Suite Pengujian Otomatis

Repositori ini dilengkapi suite pengujian bertingkat untuk menjamin keandalan sistem di bawah beban ekstrem.

### 9.1. Unit Testing
Menguji logika bisnis modul murni tanpa koneksi jaringan:
```bash
pnpm test
```

### 9.2. Integration Testing (Testcontainers Pihak Ketiga)
Menjalankan pengujian integrasi transaksional menggunakan kontainer Docker sementara:
```bash
pnpm run test:integration
```

### 9.3. Concurrency Battle Testing (1.000 Pengguna Simultan)
Menguji perebutan 1 kursi yang sama oleh 1.000 user serentak untuk membuktikan bahwa tidak terjadi double booking (zero overselling):
```bash
pnpm run test:concurrency
```

### 9.4. Pengujian Beban k6 (Load Testing)
Jika Anda telah memasang k6 (`k6 version`):
```bash
# Skenario A: Penelusuran katalog konser
pnpm run loadtest:a

# Skenario B: Lonjakan antrean ruang tunggu (queue surge)
pnpm run loadtest:b

# Skenario C: Perebutan hold kursi
pnpm run loadtest:c

# Skenario D: Alur lengkap ticket war end-to-end
pnpm run loadtest:d

# Skenario F: Banjir webhook pembayaran pihak ketiga
pnpm run loadtest:f
```

### 9.5. Pengujian Chaos Jaringan (Toxiproxy)
Memverifikasi ketahanan sistem ketika koneksi Redis atau Database mengalami latensi tinggi atau terputus sementara:
```bash
# Menyiapkan proxy toxiproxy
pnpm run chaos:setup

# Menguji perilaku fallback saat Redis terputus
pnpm run chaos:redis

# Menguji ketahanan timeout saat PostgreSQL lambat
pnpm run chaos:db
```

---

## 10. Panduan Pemecahan Masalah (Troubleshooting Guide)

### 10.1. Kesalahan Port Collision (Port Sudah Digunakan)
- **Gejala**: Docker atau Fastify gagal start dengan pesan `address already in use :::5432` atau `:::6379`.
- **Penyebab**: Terdapat instance PostgreSQL atau Redis lokal yang sedang berjalan di komputer host.
- **Solusi Windows**:
  ```powershell
  # Cari process ID yang menduduki port 5432
  Get-NetTCPConnection -LocalPort 5432 | Select-Object OwningProcess
  # Hentikan proses tersebut jika aman, atau stop service PostgreSQL lokal di services.msc
  ```
- **Solusi Linux**:
  ```bash
  sudo systemctl stop postgresql
  sudo systemctl stop redis
  ```

### 10.2. Docker Healthcheck Kafka atau PostgreSQL Gagal
- **Gejala**: Kontainer berstatus `unhealthy` setelah beberapa menit.
- **Penyebab**: Alokasi RAM Docker Desktop terlalu kecil (minimal 4 GB disarankan untuk menjalankan Kafka KRaft + Postgres + Redis).
- **Solusi**:
  1. Buka Docker Desktop Settings > Resources.
  2. Naikkan alokasi Memory minimal ke 4 GB dan CPU minimal 2 Core.
  3. Lakukan restart kontainer:
     ```bash
     docker compose --profile core restart
     ```

### 10.3. Perintah `pnpm` Tidak Dikenali di Windows PowerShell
- **Gejala**: `The term 'pnpm' is not recognized as the name of a cmdlet`.
- **Solusi**:
  Jalankan perintah berikut pada terminal yang aktif:
  ```powershell
  npx pnpm <perintah>
  # Contoh:
  npx pnpm install
  npx pnpm run dev:api
  ```
  Atau pasang pnpm secara permanen:
  ```powershell
  npm install -g pnpm
  ```

### 10.4. Reset Total Lingkungan (Clean State Reset)
Jika basis data atau antrean Redis berada dalam kondisi kotor dan Anda ingin memulai ulang dari awal:
```bash
# 1. Hentikan seluruh kontainer dan hapus volume penyimpanan
docker compose --profile core --profile observability --profile chaos down -v

# 2. Jalankan kembali kontainer bersih
docker compose --profile core up -d

# 3. Jalankan migrasi dan seeding ulang
pnpm run db:migrate
pnpm run db:seed
```

---

## 11. Lembar Rangkuman Perintah Harian (Quick Reference Cheatsheet)

```bash
# Mulai infrastruktur pihak ketiga
docker compose --profile core up -d

# Jalankan 3 proses (di 3 terminal berbeda)
pnpm run dev:api         # Terminal 1: API Server (port 3000)
pnpm run dev:simulator   # Terminal 2: Payment Simulator (port 3001)
pnpm run dev:worker      # Terminal 3: Background Worker

# Jalankan validasi kualitas
pnpm run typecheck       # Cek tipe TypeScript
pnpm run depcruise       # Cek batasan arsitektur modul
pnpm test                # Unit test
pnpm run test:concurrency# Concurrency 1.000 user test

# Matikan infrastruktur saat selesai bekerja
docker compose --profile core down
```
