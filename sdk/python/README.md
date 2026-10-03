# MAM Python SDK

Python SDK for MAM (Machine Agent Modules).

## Installation

```bash
pip install mam-sdk
```

## Usage

```python
from mam import parse_mam, MAMModule

# Parse a MAM file
result = parse_mam(content)

# Create a module
module = MAMModule(name="my-module", version="1.0.0")
```
