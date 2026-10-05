# ticket-in

ticket-in adalah platform backend penjualan tiket konser berskala tinggi yang dirancang untuk menangani perebutan kursi bernomor di bawah beban lalu lintas ekstrem. Sistem ini menggunakan arsitektur modular monolith tiga proses dengan Fastify, TypeScript strict, Drizzle ORM, PostgreSQL, Redis, dan Apache Kafka. Keandalan data dijamin melalui validasi status transaksional di basis data, antrean ruang tunggu berbasis Redis ZSET, dan mesin transactional outbox.

---

## Quickstart

Jalankan seluruh lingkungan pengembangan lokal dengan lima perintah berikut:

```bash
# 1. Pasang seluruh dependensi proyek
pnpm install

# 2. Siapkan variabel lingkungan
cp .env.example .env

# 3. Jalankan infrastruktur pendukung lokal (PostgreSQL, Redis, Kafka KRaft)
docker compose --profile core up -d

# 4. Terapkan migrasi skema basis data dan masukkan data awal
pnpm run db:migrate && pnpm run db:seed

# 5. Jalankan server aplikasi HTTP
pnpm run dev:api
```

Dokumentasi interaktif OpenAPI Swagger dapat diakses melalui peramban pada alamat `http://localhost:3000/docs`. Halaman demonstrasi interaktif pengguna tersedia pada `http://localhost:3000/`.

---

## Peta Struktur Repositori

```
ticket-in/
├── src/
│   ├── entrypoints/          # Titik masuk proses: api.ts, worker.ts, payment-simulator.ts
│   ├── modules/              # Modul domain, application, infrastructure, interface
│   │   ├── identity/
│   │   ├── catalog/
│   │   ├── waiting-room/
│   │   ├── inventory/
│   │   ├── reservation/
│   │   ├── order/
│   │   ├── payment/
│   │   ├── ticketing/
│   │   ├── notification/
│   │   └── platform/
│   └── web/                  # Halaman demonstrasi tunggal: index.html
├── migrations/               # Berkas migrasi skema SQL terkelola Drizzle Kit
├── test/                     # Suite pengujian unit, integration, concurrency, e2e, security
├── loadtest/                 # Skenario pengujian beban k6 (Skenario A hingga F)
├── chaos/                    # Skrip pengujian kekacauan sistem dan konfigurasi Toxiproxy
├── scripts/                  # Skrip pemeriksa invarian data, seeding, dan otomasi
├── observability/            # Dasbor Grafana, metrik Prometheus, dan konfigurasi alert
├── deploy/                   # Multi-stage Dockerfile dan konfigurasi Docker Compose
├── docs/                     # Dokumentasi arsitektur, skema DB, rute API, dan ancaman
├── .agents/                  # Aturan dan skill integrasi Antigravity IDE
├── .vscode/                  # Pengaturan kerja, ekstensi, dan task runner VSCode
├── AGENTS.md                 # Panduan kerja agen AI dan aturan konfirmasi bertahap
├── PRD.md                    # Product Requirements Document (Single Source of Truth)
├── SKILL.md                  # Spesifikasi teknis rekayasa dan standar implementasi
├── compose.yaml              # Orkestrasi kontainer dengan profiles
├── Makefile                  # Target otomasi build, test, dan lint
└── package.json              # Definisi dependensi dan skrip proyek
```

---

## Indeks Dokumentasi

- [`AGENTS.md`](./AGENTS.md): Protokol kerja, alur bertahap, dan panduan AI coding agent.
- [`PRD.md`](./PRD.md): Dokumen kebutuhan produk dan kriteria penerimaan fungsional.
- [`SKILL.md`](./SKILL.md): Spesifikasi teknis, standar penulisan kode, dan pengujian.
- [`docs/architecture.md`](./docs/architecture.md): Topologi sistem tiga proses dan transactional outbox pattern.
- [`docs/database-schema.md`](./docs/database-schema.md): Skema relasional PostgreSQL, UUIDv7, dan partial index.
- [`docs/api-routes.md`](./docs/api-routes.md): Ringkasan endpoint RESTful Fastify dan kode status HTTP.
- [`docs/cross-platform-guide.md`](./docs/cross-platform-guide.md): Panduan lintas platform (Windows dan Linux) dan Docker Compose profile.
- [`docs/security/threat-model.md`](./docs/security/threat-model.md): Model ancaman STRIDE, mitigasi bot, dan pencegahan kecurangan.
