---
id: web-search-tool
name: Web Search Tool
version: 1.0.0
author: LifeJiggy
runtime: python
provider: google
tags:
  - tool
  - search
---

## Purpose

Search the web using Google Custom Search API.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| num_results | int | No | Number of results (default 10) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| results | array | Search results with title, url, snippet |

## Dependencies

- google-api-python-client >= 2.0.0

## Examples

```python
tool = WebSearchTool()
results = tool.execute("MAM compiler")
```
