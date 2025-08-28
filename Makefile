SHELL := /bin/bash

up:
	docker compose up -d --build

down:
	docker compose down

ps:
	docker compose ps

logs:
	docker compose logs -f --tail=200

restart:
	docker compose restart

