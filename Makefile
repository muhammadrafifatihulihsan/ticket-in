.PHONY: install dev-api dev-worker dev-sim up-core down-core typecheck lint test build check-invariants

install:
	npx pnpm install

dev-api:
	npx pnpm run dev:api

dev-worker:
	npx pnpm run dev:worker

dev-sim:
	npx pnpm run dev:simulator

up-core:
	docker compose --profile core up -d

down-core:
	docker compose --profile core down

typecheck:
	npx pnpm run typecheck

lint:
	npx pnpm run lint

test:
	npx pnpm test

build:
	npx pnpm run build

check-invariants:
	npx pnpm run db:check-invariants
