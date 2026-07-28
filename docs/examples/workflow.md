# Workflow Examples

> **Complex workflow patterns in MAM modules.**

---

## ETL Workflow

Extract, Transform, Load pipeline:

```markdown
---
id: etl-pipeline
version: 1.0.0
name: ETL Pipeline
author: LifeJiggy
runtime: python
tags:
  - etl
  - pipeline
  - data
permissions:
  - network
  - filesystem
---

## Purpose

Complete ETL pipeline with error handling and logging.

## Workflow

```mermaid
flowchart TD
    A[Extract Data] --> B{Valid Format?}
    B -->|Yes| C[Transform Data]
    B -->|No| D[Log Error]
    C --> E[Validate Schema]
    E --> F{Valid?}
    F -->|Yes| G[Load to Database]
    F -->|No| D
    G --> H[Log Success]
    H --> I[Return Results]
    D --> J[Return Error]
```

## Python

```python
def extract(source: str) -> list:
    """Extract data from source."""
    # Implementation
    pass

def transform(data: list) -> list:
    """Transform data."""
    # Implementation
    pass

def load(data: list, destination: str) -> bool:
    """Load data to destination."""
    # Implementation
    pass

def etl_pipeline(source: str, destination: str) -> dict:
    """Main ETL pipeline."""
    try:
        # Extract
        data = extract(source)
        print(f"Extracted {len(data)} records")
        
        # Transform
        transformed = transform(data)
        print(f"Transformed {len(transformed)} records")
        
        # Load
        success = load(transformed, destination)
        if success:
            print("Loaded successfully")
            return {"success": True, "records": len(transformed)}
        else:
            return {"success": False, "error": "Load failed"}
    
    except Exception as e:
        return {"success": False, "error": str(e)}
```
```

---

## Approval Workflow

Multi-step approval process:

```markdown
---
id: approval-workflow
version: 1.0.0
name: Approval Workflow
author: LifeJiggy
runtime: python
tags:
  - approval
  - workflow
  - business
---

## Purpose

Multi-step approval workflow with notifications.

## Workflow

```mermaid
flowchart TD
    A[Submit Request] --> B[Manager Review]
    B --> C{Approved?}
    C -->|Yes| D[Director Review]
    C -->|No| E[Reject]
    D --> F{Approved?}
    F -->|Yes| G[Execute Request]
    F -->|No| E
    G --> H[Notify Requester]
    E --> H
```

## Python

```python
def submit_request(request: dict) -> dict:
    """Submit request for approval."""
    return {
        "id": generate_id(),
        "status": "pending_manager",
        "request": request,
        "history": [{"action": "submitted", "timestamp": now()}]
    }

def manager_review(request_id: str, approved: bool, comments: str) -> dict:
    """Manager review step."""
    request = get_request(request_id)
    
    if approved:
        request["status"] = "pending_director"
    else:
        request["status"] = "rejected"
    
    request["history"].append({
        "action": "manager_review",
        "approved": approved,
        "comments": comments,
        "timestamp": now()
    })
    
    return request

def director_review(request_id: str, approved: bool, comments: str) -> dict:
    """Director review step."""
    request = get_request(request_id)
    
    if approved:
        request["status"] = "approved"
        execute_request(request)
    else:
        request["status"] = "rejected"
    
    request["history"].append({
        "action": "director_review",
        "approved": approved,
        "comments": comments,
        "timestamp": now()
    })
    
    return request
```
```

---

## Data Sync Workflow

Synchronize data between systems:

```markdown
---
id: data-sync
version: 1.0.0
name: Data Sync Workflow
author: LifeJiggy
runtime: python
tags:
  - sync
  - data
  - integration
permissions:
  - network
---

## Purpose

Synchronize data between multiple systems with conflict resolution.

## Workflow

```mermaid
flowchart TD
    A[Fetch Source Data] --> B[Fetch Target Data]
    B --> C[Compare Data]
    C --> D{Conflicts?}
    D -->|No| E[Apply Changes]
    D -->|Yes| F[Resolve Conflicts]
    F --> E
    E --> G[Verify Sync]
    G --> H[Log Results]
```

## Python

```python
def sync_data(source: str, target: str) -> dict:
    """Sync data between source and target."""
    # Fetch data
    source_data = fetch_data(source)
    target_data = fetch_data(target)
    
    # Compare
    conflicts = find_conflicts(source_data, target_data)
    
    # Resolve conflicts
    if conflicts:
        resolved = resolve_conflicts(conflicts)
    else:
        resolved = source_data
    
    # Apply changes
    apply_changes(target, resolved)
    
    # Verify
    verification = verify_sync(source, target)
    
    return {
        "synced": True,
        "conflicts": len(conflicts),
        "verification": verification
    }
```
```

---

## Notification Workflow

Send notifications through multiple channels:

```markdown
---
id: notification-workflow
version: 1.0.0
name: Notification Workflow
author: LifeJiggy
runtime: python
tags:
  - notification
  - messaging
  - workflow
permissions:
  - network
---

## Purpose

Send notifications through email, SMS, and push notifications.

## Workflow

```mermaid
flowchart TD
    A[Receive Event] --> B[Determine Channels]
    B --> C{Email?}
    C -->|Yes| D[Send Email]
    B --> E{SMS?}
    E -->|Yes| F[Send SMS]
    B --> G{Push?}
    G -->|Yes| H[Send Push]
    D --> I[Log Results]
    F --> I
    H --> I
```

## Python

```python
def send_notification(event: dict, channels: list) -> dict:
    """Send notification through specified channels."""
    results = {}
    
    if "email" in channels:
        results["email"] = send_email(event)
    
    if "sms" in channels:
        results["sms"] = send_sms(event)
    
    if "push" in channels:
        results["push"] = send_push(event)
    
    return results

def send_email(event: dict) -> bool:
    """Send email notification."""
    # Implementation
    return True

def send_sms(event: dict) -> bool:
    """Send SMS notification."""
    # Implementation
    return True

def send_push(event: dict) -> bool:
    """Send push notification."""
    # Implementation
    return True
```
```

---

## Next Steps

- [Agent Examples](./agent.md) — AI agent modules
- [Writing Modules](../guides/writing-modules.md) — How to write modules

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
