# 🟥 HUMAN_TASKS.md

Things we **cannot** do from this sandbox because they cost money or need a human: an account, a
payment method, a DNS record, a legal entity, or a machine that stays on.

**The rule binds both agents.** Whoever hits one of these does not stop and does not silently
scope it out. They log it here with the exact action a human must take, implement the $0
demo/manual path around it, and keep building.

Legend — `BLOCKING` a real user cannot use the thing at all without it · `COMMERCIAL` needed to
take money, not needed to build or self-host · `OPS` needed for a 24/7 hosted tier.

---

## Open

### 1. Public inbound URL for real third-party webhooks — `BLOCKING (hosted use only)`

- **What:** Stripe/GitHub/Shopify sending a webhook to *us* requires a reachable, always-on
  HTTPS endpoint.
- **Why a human:** needs a machine that never sleeps + a domain + TLS. The sandbox preview dies
  with the session. *Verified constraint: the sandbox even blocks outbound `fetch()` to arbitrary
  hosts (ECONNRESET / TLS interception); only the npm registry answered. So the sandbox can
  neither receive arbitrary public traffic nor reliably deliver to arbitrary public hosts.*
- **$0 workaround shipped instead:** the product is **self-hosted-first** — the user runs it on
  their own host, where their own ingress already exists. Demo mode is fully hermetic: it delivers
  to an in-process target simulator, so the demo never depends on the network.
- **Human action:** rent a small VPS + point a domain at it, if we ever want to demo real egress.

### 2. Real payment collection for Free / Pro $49 / Max $100 — `COMMERCIAL`

- **What:** charging money for Pro/Max.
- **Why a human:** Stripe (or any PSP) needs a legal entity, a bank account and live API keys.
- **$0 workaround shipped instead:** manual/demo plan activation (an admin endpoint + a plan row),
  with **plan gating enforced server-side in code**. The gating is real; only the money is fake.
- **Human action:** create the PSP account and paste live keys once a human wants revenue.

### 3. Terms of Service / Privacy Policy / DPA — `COMMERCIAL`

- **What:** the documents a buyer's legal team asks for before their webhook payloads (often
  containing PII and live credentials) touch our infrastructure.
- **Why a human:** needs legal review and a real entity.
- **Consequence for positioning:** we are a **confidentiality boundary, not a compliance
  boundary**. We may claim "your payloads are encrypted at rest, and we can refuse to store them at
  all" — we may **not** claim SOC 2, HIPAA or "enterprise-ready". The README must say this out loud.
- **Human action:** engage a lawyer/DPO before selling to anyone regulated.

### 4. Uptime, backups, status page, on-call — `OPS`

- **What:** anything a customer would read as an SLA.
- **Why a human:** money + people. A relay is a liability sink: once it is live, *we* own their
  outages, and every missed event is a 2am page.
- **Consequence for pricing:** Pro/Max gate **capability** (endpoints, retention, replay window,
  seats, retry policy, alerting), never **reliability**. No marketing copy may imply uptime.
- **Human action:** only relevant if we ever run a hosted tier for strangers.

---

## Closed / discharged by a $0 workaround

_(filled in as we go — each entry names the workaround and where it lives)_
