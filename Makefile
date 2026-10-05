.PHONY: install dev-api dev-worker dev-sim up-core down-core typecheck lint format-check depcruise test build check-invariants ci

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

format-check:
	npx pnpm run format:check

depcruise:
	npx pnpm run depcruise

test:
	npx pnpm test

build:
	npx pnpm run build

check-invariants:
	npx pnpm run db:check-invariants

ci: typecheck lint format-check depcruise test build
