---
id: research-agent
version: 1.0.0
name: Research Agent System
author: MAM Team
runtime: python
tags:
  - agent
  - multi-agent
  - research
  - advanced
description: Multi-agent system that researches topics, analyzes findings, and produces reports
---

# Research Agent System

## Purpose

A coordinated multi-agent system where a Planner delegates research tasks to a Researcher agent, which produces structured findings that a Writer agent compiles into a final report.

## System Definition

module ResearchSystem

type:
    system

agents:
    - Planner
    - Researcher
    - Writer

edges:
    Planner -> Researcher
    Researcher -> Writer

memory:
    shared: ResearchMemory

policy:
    ReadOnlyPolicy

## Agent: Planner

module Planner

type:
    agent

role:
    Planning

goal:
    Decompose a research topic into focused sub-questions and assign them to the Researcher

memory:
    shared

tools:
    - PlannerTool

handoff:
    - Researcher

## Agent: Researcher

module Researcher

type:
    agent

role:
    Research

goal:
    Gather information for each sub-question from available sources and return structured findings

memory:
    shared

tools:
    - Python
    - Search

handoff:
    - Writer

## Agent: Writer

module Writer

type:
    agent

role:
    Writing

goal:
    Synthesize all findings into a coherent, well-structured report

memory:
    shared

tools:
    - Python

## Tool: Search

module SearchTool

type:
    tool

provider:
    search-api

permissions:
    network: internet

capabilities:
    - search
    - summarize

## Tool: PlannerTool

module PlannerTool

type:
    tool

provider:
    planner

capabilities:
    - plan
    - prioritize

## Tool: Python

module PythonRuntime

type:
    tool

provider:
    python

permissions:
    python: sandbox

capabilities:
    - execute
    - analyze

## Memory: ResearchMemory

module ResearchMemory

type:
    memory

format:
    vector

backend:
    sqlite

scope:
    workspace

ttl:
    12h

## Policy: ReadOnlyPolicy

module ReadOnlyPolicy

type:
    policy

allow:
    - search
    - python

deny:
    - shell.rm
    - network.internal
    - filesystem.write

permissions:
    filesystem: read
    network: internet
    python: sandbox
