# Company Research Pipeline - API Verification Research

**Date:** 2026-09-06
**Task:** Verify six facts about Parallel Task API, Vercel AI SDK, Trigger.dev v4, and Zefix REST API for Swiss company research pipeline integration.

## Research Findings

### 1. Parallel Task API
- **Package Name:** `parallel-web` (confirmed via docs.parallel.ai)
- **Major Version:** ^1.0.1 (current in npm)
- **Processor Tiers:** Documentation confirms `base`, `core`, `ultra` (lite and pro not found in current docs)
- **Schema Passing:** Via `{"type": "json", "json_schema": {...}}` structure (docs.parallel.ai/task-api/task-quickstart)
- **Basis/Citations Field:** NOT verified in fetched docs; requires deeper API reference check
- **Per-field basis structure:** UNVERIFIED - not found in quickstart docs

### 2. Parallel Result Waiting
- **Methods confirmed:** Blocking result call with timeout (api_timeout parameter), polling, webhooks, SSE
- **Blocking timeout:** Mentioned as optional `api_timeout` parameter (e.g., 3600 seconds)
- **No explicit max timeout limit found:** May be implementation dependent

### 3. Parallel Data Residency
- UNVERIFIED - no region/residency information found in searched docs
- No EU data processing agreement mentioned in available documentation

### 4. Vercel AI SDK
- **Current Major Version:** v7 (Latest) on npm as `ai` package
- **Structured Output Function:** `Output.object()` with `generateText()` (current best practice)
- **Deprecated:** `generateObject()` is deprecated in favor of `generateText` + `Output.object()`
- **AI Gateway Config:** Page redirects to ai-sdk.dev; full gateway config details NOT in the generate-object doc page

### 5. Trigger.dev v4
- **wait.for({ seconds }):** CONFIRMED - does NOT consume compute during wait
- **maxDuration:** CONFIRMED - task option, minimum 5 seconds
- **Excluded from CPU time:** `wait.for` calls explicitly excluded from maxDuration calculation
- **Lifecycle on exceed:** Functions not invoked when maxDuration exceeded

### 6. Zefix REST API
- **Existence:** CONFIRMED - public REST API available at zefix.admin.ch
- **Registration:** CONFIRMED - requires free account with Basic auth; email zefix@bj.admin.ch to request
- **Official Doc URL:** https://www.zefix.admin.ch/ZefixPublicREST/swagger-ui/index.html (Swagger UI)
- **Endpoints:** TEST: https://www.zefixintg.admin.ch/ZefixPublicREST/api/v1; PROD: https://www.zefix.admin.ch/ZefixPublicREST/api/v1

## Unverified Items
1. Parallel processor tier names (pro, ultra only partially confirmed; core confirmed, base confirmed, lite NOT found)
2. Parallel per-field basis structure details (confidence, reasoning fields)
3. Parallel data residency / EU DPA options
4. Vercel AI Gateway API key configuration details (redirect not fully followed)
