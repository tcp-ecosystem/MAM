# Audit

The Audit layer records security-relevant events, redacts secrets on the way
in, queries the log, detects rule-based anomalies and aggregates security
reports.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `AuditEvent`, `AuditEventInput`, `RedactConfig`, `AnomalyRule`, `AnomalyFlag`, `SecurityReport`, `AuditConfig`, `AuditStats` |
| `store.ts` | `AuditStore`: append-only, capacity-bounded log, `getByType`, prune, `toJSON`/`fromJSON` |
| `index.ts` | `AuditIndex`: by type/actor/result/severity buckets |
| `retrieval.ts` | `AuditQuery`: `recent`, `byType`, `byActor`, `denied`, `range`, `summary`, `counts` |
| `lifecycle.ts` | `AuditLifecycle` (retention prune, index sync) + `detectAnomalies`/`evaluateRule`/`evaluateDenialBurst` |
| `integration.ts` | `AuditLogger` (record + convenience recorders), `SecurityReporter` (report/summary), `Redactor`, factories |

## Example

```ts
import { createAuditLogger, createSecurityReporter, Redactor } from '@mam/security';

const audit = createAuditLogger();
audit.start();
audit.recordAllowed('document.read', 'alice', { target: 'doc-1' });
audit.recordDenied('document.delete', 'alice', { target: 'doc-42' });
audit.recordError('kms.decrypt', 'provider unreachable');

const flags = audit.detectAnomalies();      // denial-burst / critical / unresolved-actor
const stats = audit.stats();                // totals, per-type/result/severity
const q = audit.query();
q.recent(10); q.byType('access'); q.summary();

const report = createSecurityReporter().report();  // ratios, top actors/actions, anomalies

// Secrets are masked before storage:
const redactor = new Redactor();
redactor.redact('contact alice@example.com or token sk-abcdef12345678');
```

Events are frozen on write; the `Redactor` masks emails, API keys, bearer
tokens, JWTs, passwords, IPs and caller-supplied patterns across both the
message and the structured payload.