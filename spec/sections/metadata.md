# Metadata (Front Matter)

## Description
Metadata is defined in YAML front matter at the top of the module.

## Required Fields
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier |
| version | string | Semantic version |
| name | string | Module name |
| author | string | Module author |
| runtime | string | Primary runtime |

## Optional Fields
| Field | Type | Description |
|-------|------|-------------|
| tags | string[] | Discovery tags |
| description | string | Module description |
| dependencies | string[] | Module dependencies |
| permissions | string[] | Required permissions |
| license | string | License identifier |
| repository | string | Source repository URL |
| mam_version | string | MAM spec version |

## Example
```yaml
---
id: authentication
version: 1.0.0
name: Authentication Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
description: Secure JWT authentication
permissions:
  - network
license: MIT
---
```