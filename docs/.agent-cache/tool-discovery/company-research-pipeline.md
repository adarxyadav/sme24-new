# Tool Discovery Results: Company Research Pipeline

Date: 2026-09-06

## Tools Searched

### 1. Parallel (parallel-web, parallel.ai)

#### Agent Skills Found
- **parallel-web/parallel-agent-skills@parallel-deep-research** (13.9K installs) — Deep research across web sources
- **parallel-web/parallel-agent-skills@parallel-web-search** (12.8K installs) — Real-time web search API
- **parallel-web/parallel-agent-skills@parallel-web-extract** (12K installs) — Web content extraction
- **parallel-web/parallel-agent-skills@parallel-data-enrichment** (12K installs) — Data enrichment capabilities
- **parallel-web/parallel-agent-skills@setup** (7.5K installs) — Setup and configuration
- **parallel-web/parallel-agent-skills@parallel-cli-setup** (4.4K installs) — CLI setup
- **parallel-web/parallel-agent-skills@parallel-memory** (758 installs) — Memory/context management
- **parallel-web/parallel-agent-skills@parallel-monitor** (10.8K installs) — Monitoring and status
- **parallel-web/parallel-agent-skills@parallel-findall** (10.7K installs) — Find all capability
- **parallel-web/parallel-agent-skills@status** (11.9K installs) — Status tracking
- **parallel-web/parallel-agent-skills@result** (11.9K installs) — Result retrieval
- **parallel-web/parallel-agent-skills@migrate-to-parallel** (1.7K installs) — Migration utility

Confidence: HIGH (12,000+ installs across core skills, official org)

#### MCP Servers Found
- **Parallel Search MCP** (Official) — URL: https://search.parallel.ai/mcp
  - Provides: web_search, web_fetch for real-time search
  - Transport: Streamable HTTP
  - Authentication: None (free, no API key required)
  
- **Parallel Task MCP** (Official) — Documentation at https://docs.parallel.ai/integrations/mcp/quickstart
  - Enables deep research and task initiation from LLM clients
  - Documented at https://docs.parallel.ai/

Confidence: HIGH (official servers documented at docs.parallel.ai)

---

### 2. Vercel AI SDK (ai package v7)

#### Agent Skills Status
- **vercel/ai@ai-sdk** (52.7K installs) — ALREADY INSTALLED in this project
- **vercel/ai@migrate-ai-sdk-v6-to-v7** (3.9K installs) — Migration tool for v6 to v7 upgrade
- **vercel-labs/ai@ai-sdk** (2.8K installs) — Alternative from vercel-labs (lower install count)

#### Verdict
No newer or better skill found. The installed `vercel/ai@ai-sdk` from the official Vercel org has the highest install count (52.7K) and is the canonical choice. The v6-to-v7 migration skill is available if needed for future upgrades.

Confidence: HIGH (official org, 52.7K installs, higher than community variant)

---

### 3. Zefix (Swiss Commercial Register API)

#### Agent Skills Found
- **nolpak14/getregdata@switzerland-zefix** (4 installs) — Zefix data retrieval
- **lawve-ai/awesome-legal-skills@swiss-legal-source-authority-triage-enrique-g-zbinden** (9 installs) — Swiss legal source triage (related)

#### Verdict
Minimal adoption (4 installs). No official Zefix MCP server found in search results.

Confidence: LOW (very few installs, community maintained, no official server)

---

## Summary Table

| Tool | Skills Found | MCP Servers | Recommendation |
|------|--------------|-------------|-----------------|
| Parallel (parallel-web) | 12 skills, 1.7K-13.9K installs | 2 official (Search, Task) | **INSTALL** parallel-web/parallel-agent-skills skills as needed |
| Vercel AI SDK v7 | 1 installed + v6-to-v7 migration | None | **KEEP** installed ai-sdk; no better alternative |
| Zefix | 1 community skill (4 installs) | None found | **SKIP** (minimal adoption, low confidence) |

## Notes for Company Research Pipeline Feature

1. **Parallel.ai Integration**: For web research capabilities, use the official `parallel-web/parallel-agent-skills` skills (parallel-web-search, parallel-web-extract, parallel-deep-research) which have 12K+ installs. The official MCP servers are free with no authentication required.

2. **Vercel AI SDK**: The installed ai-sdk skill (vercel/ai@ai-sdk) is the best option. No upgrade needed unless moving to v7+ requires new patterns.

3. **Zefix (Swiss Register)**: Given this is an EHS consulting marketplace targeting Swiss regulated companies, Zefix could validate company data. However, the community skill has minimal adoption. Consider building a custom integration if required, or using parallel.ai's web extraction to search Zefix directly.
