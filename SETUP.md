# Setup & Getting Started: ticket-in

Panduan ringkas instalasi dan pengoperasian sistem backend **ticket-in**. Untuk dokumentasi langkah demi langkah yang sangat mendalam dan mencakup seluruh layanan pihak ketiga (PostgreSQL, Redis, Kafka KRaft, Toxiproxy, Prometheus, Grafana), silakan baca:

👉 **[Panduan Lengkap Setup & Konfigurasi Pihak Ketiga (docs/panduan-setup-lengkap.md)](./docs/panduan-setup-lengkap.md)**

---

## Prasyarat Utama (Prerequisites)

- **Node.js**: >= 22.0.0 LTS
- **pnpm**: >= 9.0.0 (`corepack enable` atau `npm install -g pnpm`)
- **Docker & Docker Compose v2**: Untuk menjalankan stack basis data dan broker pesan
- **Git**: Dengan konfigurasi line-ending `LF`

---

## 5 Langkah Cepat Memulai (Quickstart)

```bash
# 1. Pasang dependensi
pnpm install

# 2. Siapkan variabel lingkungan
cp .env.example .env

# 3. Jalankan infrastruktur pihak ketiga (PostgreSQL, Redis, Kafka KRaft)
docker compose --profile core up -d

# 4. Jalankan migrasi basis data dan seeding 1.000 kursi uji
pnpm run db:migrate
pnpm run db:seed

# 5. Jalankan 3 proses aplikasi (buka di 3 terminal terpisah)
pnpm run dev:api         # Terminal 1: API Server (port 3000)
pnpm run dev:simulator   # Terminal 2: Payment Simulator (port 3001)
pnpm run dev:worker      # Terminal 3: Background Worker (Outbox & Sweeper)
```

---

## Endpoint Penting

- **Aplikasi Web Demonstrasi**: [http://localhost:3000/](http://localhost:3000/)
- **Dokumentasi REST API Swagger UI**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Simulator Pembayaran Pihak Ketiga**: [http://localhost:3001](http://localhost:3001)
- **Dasbor Grafana (Opsional)**: [http://localhost:3002](http://localhost:3002) (`admin` / `grafana_admin`)
- **Prometheus Metrik (Opsional)**: [http://localhost:9090](http://localhost:9090)

---

## Akun Pengguna Bawaan (Default Test Users)

| Email                         | Username    | Password              | Role      |
| ----------------------------- | ----------- | --------------------- | --------- |
| `admin@ticketin.internal`     | `admin`     | `AdminSecret123!`     | admin     |
| `organizer@ticketin.internal` | `organizer` | `OrganizerSecret123!` | organizer |
| `user1@ticketin.internal`     | `user1`     | `UserSecret123!`      | user      |
| `user2@ticketin.internal`     | `user2`     | `UserSecret123!`      | user      |

---

## Perintah Verifikasi & Pengujian

```bash
# Validasi tipe TypeScript
pnpm run typecheck

# Validasi batas arsitektur modular
pnpm run depcruise

# Unit tests
pnpm test

# Concurrency test (1.000 user perebutan kursi)
pnpm run test:concurrency
```

Untuk panduan konfigurasi variabel lingkungan yang lebih rinci, skenario pengujian beban k6, simulasi chaos Toxiproxy, dan panduan troubleshooting (Windows & Linux), silakan buka **[docs/panduan-setup-lengkap.md](./docs/panduan-setup-lengkap.md)**.
