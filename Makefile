REPO_ROOT := $(CURDIR)
SLUG ?= v2__search__spending_over_time
SEMANTIC_ROOT ?= runs/agents-sdk
AGENTS_OUT_ROOT ?= runs/agents-sdk
AGENTS_MODEL ?= gpt-5.4
AGENTS_REASONING_EFFORT ?= high
AGENTS_MAX_TURNS ?= 48
AGENTS_TIMEOUT_MS ?= 1200000
AGENTS_PROMOTE ?= 0
AGENTS_REVIEW_REPORT ?=
AGENTS_REPAIR_TASK_ID ?=
AGENTS_STORY_QUESTION ?= Use the USAspending semantic MCP to find an interesting cross-endpoint story and report any semantic gaps.
AGENTS_STORY_OUTPUT ?=
AGENTS_BUNDLE_GLOB ?=

.PHONY: verify ship-verify semantic-validate agents-install agents-test agents-smoke agents-semantic agents-review agents-repair agents-story mcp-install mcp-test mcp-server mcp-semantic-validate mcp-smoke-server mcp-smoke-client

mcp-install:
	@npm --prefix scripts/mcp install --silent

agents-install:
	@npm --prefix scripts/agents install --silent

mcp-server: mcp-install
	@$(REPO_ROOT)/scripts/mcp/bin/stdio-server

semantic-validate: agents-install
	@npm --prefix scripts/agents run semantic:validate -- --root $(SEMANTIC_ROOT)

mcp-semantic-validate: mcp-install
	@$(REPO_ROOT)/scripts/mcp/bin/validate-semantic-bundles

agents-test: agents-install
	@npm --prefix scripts/agents run typecheck
	@npm --prefix scripts/agents run test

agents-smoke: agents-install
	@npm --prefix scripts/agents run smoke

mcp-test: mcp-install
	@npm --prefix scripts/mcp run typecheck
	@npm --prefix scripts/mcp run test

mcp-smoke-server: mcp-install
	@$(REPO_ROOT)/scripts/mcp/bin/smoke-server

mcp-smoke-client: mcp-install
	@$(REPO_ROOT)/scripts/mcp/bin/smoke-client

agents-semantic: agents-install
	@npm --prefix scripts/agents run semantic:agent -- --slug $(SLUG) --out-root $(AGENTS_OUT_ROOT) --model $(AGENTS_MODEL) --reasoning-effort $(AGENTS_REASONING_EFFORT) --max-turns $(AGENTS_MAX_TURNS) --timeout-ms $(AGENTS_TIMEOUT_MS) $(if $(filter 1,$(AGENTS_PROMOTE)),--promote,)

agents-review: agents-install
	@npm --prefix scripts/agents run semantic:review -- --slug $(SLUG) --out-root $(AGENTS_OUT_ROOT) --model $(AGENTS_MODEL) --reasoning-effort $(AGENTS_REASONING_EFFORT) --max-turns $(AGENTS_MAX_TURNS) --timeout-ms $(AGENTS_TIMEOUT_MS)

agents-repair: agents-install
	@test -n "$(AGENTS_REVIEW_REPORT)" || (echo "AGENTS_REVIEW_REPORT is required, e.g. make agents-repair SLUG=v2__recipient AGENTS_REVIEW_REPORT=runs/review.json"; exit 1)
	@npm --prefix scripts/agents run semantic:repair -- --slug $(SLUG) --out-root $(AGENTS_OUT_ROOT) --review-report $(AGENTS_REVIEW_REPORT) --model $(AGENTS_MODEL) --reasoning-effort $(AGENTS_REASONING_EFFORT) --max-turns $(AGENTS_MAX_TURNS) --timeout-ms $(AGENTS_TIMEOUT_MS) $(if $(AGENTS_REPAIR_TASK_ID),--task-id $(AGENTS_REPAIR_TASK_ID),)

agents-story: agents-install
	@npm --prefix scripts/agents run semantic:story -- --question "$(AGENTS_STORY_QUESTION)" --model $(AGENTS_MODEL) --reasoning-effort $(AGENTS_REASONING_EFFORT) --max-turns $(AGENTS_MAX_TURNS) --timeout-ms $(AGENTS_TIMEOUT_MS) $(if $(AGENTS_BUNDLE_GLOB),--bundle-glob "$(AGENTS_BUNDLE_GLOB)",) $(if $(AGENTS_STORY_OUTPUT),--output $(AGENTS_STORY_OUTPUT),)

verify: agents-install mcp-install
	@npm --prefix scripts/agents run typecheck
	@npm --prefix scripts/mcp run typecheck
	@npm --prefix scripts/agents run test
	@npm --prefix scripts/mcp run test
	@npm --prefix scripts/agents run smoke
	@$(REPO_ROOT)/scripts/mcp/bin/validate-semantic-bundles
	@$(REPO_ROOT)/scripts/mcp/bin/smoke-server
	@$(REPO_ROOT)/scripts/mcp/bin/smoke-client

ship-verify: verify
