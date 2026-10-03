---
# MAM Metadata
id: template-resource-basic
name: Resource Template (Basic)
version: 2.0.0
type: resource

author: MAM Team
description: >
  A single bucket resource reconciled against a fixed size.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - template
  - resource
  - basic

dependencies:
  - name: provider-sdk
    version: "^1.0"

capabilities:
  - provision
  - status
  - reconcile
  - deprovision

permissions:
  filesystem:
    - read
  network:
    - internet
  environment:
    - read
---

# Resource Template (Basic)

## Purpose

The smallest complete resource: one provider, one size, and a reconcile loop
that converges actual state on desired state. Use
[`resource.mam`](../resource.mam) for a resource with several providers, and
[`resource-advanced.mam`](./resource-advanced.mam) for health checks and drift
reporting.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| spec | object | Yes | Desired state, e.g. `{ "size": "small" }` |
| provider | string | No | Provider name. Defaults to `example-provider` |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| id | string | Provider identifier for the resource |
| state | object | Actual state reported by the provider |
| ready | boolean | Whether actual state matches desired state |

## Capabilities

### provision

Create the resource through the provider.

### status

Read the actual state from the provider.

### reconcile

Compare desired and actual state, then apply the difference.

### deprovision

Remove the resource through the provider.

## Provider

| Field | Value | Description |
|-------|-------|-------------|
| name | example-provider | Provider that manages the resource |
| endpoint | api.example.com | Provider API endpoint |
| auth | environment | Credential source |

## Permissions

| Scope | Access | Reason |
|-------|--------|--------|
| filesystem | read | Read the local spec file |
| network | internet | Reach the provider API |
| environment | read | Read provider credentials |

## Rules

- The resource is only changed through its provider.
- Credentials come from the environment and are never logged.
- Reconcile is idempotent and safe to repeat.
- A failed apply leaves the resource in its previous state.

## Workflow

```mermaid
flowchart TD
    A[spec] --> B[provision]
    B --> C[status]
    C --> D{ready}
    D -->|No| E[reconcile]
    E --> C
    D -->|Yes| F[ready]
    F --> G[deprovision]
```

## Python

```python
class Resource:
    def __init__(self, provider="example-provider", spec=None):
        self.provider = provider
        self.spec = spec or {}
        self.state = {}
        self.id = None

    def provision(self):
        self.id = f"{self.provider}:bucket"
        self.state = dict(self.spec)
        return self.id

    def status(self):
        return {"id": self.id, "state": dict(self.state)}

    def ready(self):
        return bool(self.id) and self.state == self.spec

    def reconcile(self):
        if self.id is None:
            return self.provision()
        self.state = dict(self.spec)
        return self.id

    def deprovision(self):
        self.id = None
        self.state = {}
        return None
```

## Tests

### Input

```yaml
spec:
  size: small
provider: example-provider
```

### Expected

```yaml
ready: true
```

```python
def test_provision_and_reconcile():
    resource = Resource(spec={"size": "small"})
    resource.provision()
    assert resource.ready() is True

    resource.spec = {"size": "large"}
    resource.reconcile()
    assert resource.status()["state"] == {"size": "large"}

    assert resource.deprovision() is None
    assert resource.ready() is False
```

## Examples

```python
resource = Resource(provider="example-provider", spec={"size": "small"})
resource.provision()
resource.reconcile()
print(resource.status())
resource.deprovision()
```

## References

- MAM Resource Provider Interface
- MAM Permission Model
