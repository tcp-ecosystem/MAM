# System Example

Order Processing System — A system is not a big module, it is a wiring decision. This one takes an order through three parts that each own exactly one concern, in an order where a refusal by an earlier part makes a later part's work pointless. Validation is free, charging moves money, fulfilment moves goods, and only validation is allowed to run before the system knows the order is worth processing at all.

## Layout

```text
modules/examples/system/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── system.mam + system.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `system.mam` | Order Processing System | system | A system is not a big module, it is a wiring decision. This one takes an order through three parts that each own exactly one concern, in an order where a refusal by an earlier part makes a later part's work pointless. Validation is free, charging moves money, fulfilment moves goods, and only validation is allowed to run before the system knows the order is worth processing at all. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/system.mam
```

## What You'll Learn

- `validate_order` — Order Processing System
- `charge_order` — Order Processing System
- `fulfil_order` — Order Processing System
- `orchestrate` — Order Processing System

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/system/)
- [MAM specification](../../../plan-doc/full-mam.md)
