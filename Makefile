IMAGE_APP        := gssk-budget
CONTAINER_BIN    := container
# Node comes from the Playwright base image; .node-version is what CI reads.
NODE_VERSION     := $(shell cat .node-version)
WORKDIR          := /app

# Allocate a TTY only when one exists. Passing -it without a terminal (CI, an
# agent shell) fails with NSPOSIXErrorDomain Code=19.
INTERACTIVE      := $(shell [ -t 0 ] && echo 1)
ifdef INTERACTIVE
TTY_FLAGS        := -it
else
TTY_FLAGS        :=
endif

.PHONY: start image install dev build-app typecheck test-unit test xcheck-validator diagrams clean

# --------------------------------------------------
# Container daemon
# --------------------------------------------------

start: ## Start the Apple container system daemon
	$(CONTAINER_BIN) system start

image: start ## Build dev container image (Playwright noble)
	$(CONTAINER_BIN) build -f Containerfile -t $(IMAGE_APP) .

# --------------------------------------------------
# Compilation and serving targets
# --------------------------------------------------

install: start ## Run package installation inside container
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm install

dev: start ## Start Vite dev server inside container
	$(CONTAINER_BIN) run --rm $(TTY_FLAGS) -p 5173:5173 -v $(shell pwd):$(WORKDIR) --name gssk-budget-dev $(IMAGE_APP) npm run dev

build-app: start ## Compile optimized static assets (Vite)
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run build

typecheck: start ## Type-check with tsgo (TypeScript 7) inside container
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run typecheck

# Unit tests need no install: node strips the types and node:test is built in,
# which is REQ-TEST-2's whole point. This target therefore runs on a bare
# checkout, before `make install` has ever been called.
test-unit: start ## Run node --test unit tests inside container
	$(CONTAINER_BIN) run --rm -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run test:unit

# No published port: Playwright starts its own Vite inside the container and
# connects to it there. Publishing 5173 would only collide with `make dev`.
test: start ## Run Playwright E2E integration tests inside container
	$(CONTAINER_BIN) run --rm $(TTY_FLAGS) -v $(shell pwd):$(WORKDIR) $(IMAGE_APP) npm run e2e

# --------------------------------------------------
# Model-layer checks
# --------------------------------------------------

# Differential-tests the hand-written validator against Python's jsonschema
# (ADR 1). Dev-only and deliberately outside `make test-unit`: it needs Python
# and jsonschema, and the point of the hand-written validator is that the
# shipped gate needs neither. Run it whenever gssk.schema.json is re-vendored.
xcheck-validator: ## Differential-test src/core/model/validate.ts against jsonschema
	python3 tools/xcheck-validator.py

diagrams: ## Render the reference models to SVG
	python3 tools/render-diagram.py docs/diagrams/*.json

clean: ## Clear compiled directories and node dependencies
	rm -rf node_modules dist .vite playwright-report test-results
