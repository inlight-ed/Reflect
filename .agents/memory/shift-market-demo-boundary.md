---
name: SHIFT/MARKET demo boundary
description: Durable product rule for separating transparent demo analytics from future Kaspi, Redstat, and media integrations.
---

SHIFT/MARKET must label synthetic data as demo data and use “estimated incremental sales” plus confidence for campaign impact; it must not imply live integrations or exact causal attribution before connectors are actually configured.

**Why:** The product brief prioritizes trust: sellers should know which numbers are observed, which are synthetic, and how certain an AI recommendation is.

**How to apply:** Preserve `DATA / DEMO` / source labels, connector status states, deterministic scoring, and confidence-bearing recommendations when replacing the demo adapter with persistence or live APIs.