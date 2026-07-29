---
id: multi-agent-debate
version: 1.0.0
name: Multi-Agent Debate System
author: MAM Team
runtime: python
tags:
  - agent
  - multi-agent
  - debate
  - reasoning
  - advanced
description: A structured debate system where an Advocate argues FOR a proposition, an Opponent argues AGAINST it, and a Judge evaluates both arguments to produce a balanced verdict.
---

# Multi-Agent Debate System

## Purpose

A coordinated multi-agent system that simulates structured debate. The Advocate defends a proposition, the Opponent challenges it, and the Judge assesses both arguments for logical soundness and evidence quality. Shared memory ensures all agents have full context throughout the exchange.

## System Definition

module DebateSystem

type:
    system

agents:
    - Advocate
    - Opponent
    - Judge

edges:
    Advocate -> Opponent
    Opponent -> Judge

memory:
    shared: DebateMemory

policy:
    DebatePolicy

## Agent: Advocate

module Advocate

type:
    agent

role:
    Debate

goal:
    Construct the strongest possible argument in favor of the given proposition using evidence, logic, and rhetorical clarity

memory:
    shared

tools:
    - Python

handoff:
    - Opponent

## Agent: Opponent

module Opponent

type:
    agent

role:
    Debate

goal:
    Challenge the Advocate's argument by identifying logical fallacies, presenting counter-evidence, and offering alternative interpretations

memory:
    shared

tools:
    - Python

handoff:
    - Judge

## Agent: Judge

module Judge

type:
    agent

role:
    Evaluation

goal:
    Objectively evaluate both arguments on evidence quality, logical consistency, and persuasiveness to render a balanced verdict

memory:
    shared

tools:
    - Python

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
    - evaluate

## Memory: DebateMemory

module DebateMemory

type:
    memory

format:
    key-value

backend:
    sqlite

scope:
    session

ttl:
    1h

## Policy: DebatePolicy

module DebatePolicy

type:
    policy

allow:
    - python
    - debate

deny:
    - personal-attacks
    - ad-hominem
    - hate-speech

permissions:
    filesystem: read
    python: sandbox

## Python

```python
from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum
import re


class Stance(Enum):
    FOR = "for"
    AGAINST = "against"
    NEUTRAL = "neutral"


@dataclass
class Argument:
    agent_id: str
    stance: Stance
    claim: str
    evidence: List[str] = field(default_factory=list)
    rebuttal: Optional[str] = None
    score: float = 0.0


@dataclass
class DebateVerdict:
    winner: str
    advocate_score: float
    opponent_score: float
    reasoning: str
    evidence_quality: float
    logical_soundness: float


@dataclass
class DebateMemory:
    proposition: str = ""
    advocate_argument: Optional[Argument] = None
    opponent_argument: Optional[Argument] = None
    verdict: Optional[DebateVerdict] = None
    turn_count: int = 0

    def store(self, key: str, value) -> None:
        setattr(self, key, value)

    def retrieve(self, key: str):
        return getattr(self, key, None)


AD_HOMINEM_PATTERNS = [
    r"you are",
    r"you're so",
    r"everyone knows you",
    r"only an idiot",
    r"you must be",
]


def is_personal_attack(text: str) -> bool:
    text_lower = text.lower()
    return any(re.search(p, text_lower) for p in AD_HOMINEM_PATTERNS)


def evaluate_evidence(evidence: List[str]) -> float:
    if not evidence:
        return 0.0
    score = min(len(evidence) * 0.2, 1.0)
    specificity_bonus = sum(
        0.1 for e in evidence if any(c.isdigit() for c in e)
    )
    return min(score + specificity_bonus, 1.0)


def evaluate_logic(argument: Argument) -> float:
    score = 0.0
    if argument.claim:
        score += 0.3
    if len(argument.evidence) >= 2:
        score += 0.3
    if argument.rebuttal:
        score += 0.2
    if len(argument.claim.split()) > 10:
        score += 0.2
    return min(score, 1.0)


def construct_advocate_argument(
    proposition: str, evidence: List[str]
) -> Argument:
    claim = (
        f"After careful analysis, the evidence strongly supports: {proposition}. "
        f"Multiple data points confirm this position."
    )
    return Argument(
        agent_id="advocate",
        stance=Stance.FOR,
        claim=claim,
        evidence=evidence,
        score=evaluate_evidence(evidence) + evaluate_logic(
            Argument(
                agent_id="advocate",
                stance=Stance.FOR,
                claim=claim,
                evidence=evidence,
            )
        ),
    )


def construct_opponent_argument(
    proposition: str, advocate_argument: Argument, counter_evidence: List[str]
) -> Argument:
    rebuttal = (
        f"The Advocate's position overlooks critical counterpoints. "
        f"Specifically: {advocate_argument.evidence[0] if advocate_argument.evidence else 'no evidence provided'} "
        f"does not account for broader context."
    )
    claim = (
        f"The proposition '{proposition}' is contested by substantial counter-evidence "
        f"and logical limitations in the Advocate's reasoning."
    )
    arg = Argument(
        agent_id="opponent",
        stance=Stance.AGAINST,
        claim=claim,
        evidence=counter_evidence,
        rebuttal=rebuttal,
    )
    arg.score = evaluate_evidence(counter_evidence) + evaluate_logic(arg)
    return arg


def judge_debate(
    advocate: Argument, opponent: Argument
) -> DebateVerdict:
    adv_evidence = evaluate_evidence(advocate.evidence)
    opp_evidence = evaluate_evidence(opponent.evidence)
    adv_logic = evaluate_logic(advocate)
    opp_logic = evaluate_logic(opponent)
    adv_score = (adv_evidence + adv_logic) / 2
    opp_score = (opp_evidence + opp_logic) / 2

    if adv_score > opp_score:
        winner = "advocate"
        reasoning = (
            "The Advocate presented stronger evidence and more logically "
            "consistent reasoning."
        )
    elif opp_score > adv_score:
        winner = "opponent"
        reasoning = (
            "The Opponent's counter-evidence and rebuttal undermined the "
            "Advocate's core claims."
        )
    else:
        winner = "tie"
        reasoning = "Both sides presented equally compelling arguments."

    return DebateVerdict(
        winner=winner,
        advocate_score=round(adv_score, 3),
        opponent_score=round(opp_score, 3),
        reasoning=reasoning,
        evidence_quality=round((adv_evidence + opp_evidence) / 2, 3),
        logical_soundness=round((adv_logic + opp_logic) / 2, 3),
    )


def run_debate(
    proposition: str,
    advocate_evidence: List[str],
    opponent_evidence: List[str],
) -> DebateVerdict:
    memory = DebateMemory(proposition=proposition)

    advocate_arg = construct_advocate_argument(proposition, advocate_evidence)
    memory.store("advocate_argument", advocate_arg)

    opponent_arg = construct_opponent_argument(
        proposition, advocate_arg, opponent_evidence
    )
    memory.store("opponent_argument", opponent_arg)

    verdict = judge_debate(advocate_arg, opponent_arg)
    memory.store("verdict", verdict)

    return verdict
```

## Examples

```python
proposition = "Artificial intelligence will replace most white-collar jobs within a decade"

advocate_evidence = [
    "GPT-4 scored in the 90th percentile on the bar exam, showing legal reasoning capability",
    "McKinsey reports that 60% of office tasks can be automated with current AI technology",
    "GitHub Copilot reduces coding time by 55%, indicating rapid productivity gains",
]

opponent_evidence = [
    "Historical automation waves created more jobs than they destroyed over time",
    "AI systems still require human oversight for critical decisions",
    "Regulatory frameworks will likely slow adoption significantly",
]

verdict = run_debate(proposition, advocate_evidence, opponent_evidence)
print(verdict.winner)        # advocate or opponent or tie
print(verdict.advocate_score)
print(verdict.opponent_score)
print(verdict.reasoning)
```

## Tests

```python
def test_is_personal_attack():
    assert is_personal_attack("You are an idiot") is True
    assert is_personal_attack("Your argument lacks evidence") is False
    assert is_personal_attack("Only an idiot would say that") is True


def test_evaluate_evidence_empty():
    assert evaluate_evidence([]) == 0.0


def test_evaluate_evidence_with_data():
    score = evaluate_evidence(["Fact A", "Fact B", "Fact C with 42% data"])
    assert score > 0.5


def test_construct_advocate_argument():
    arg = construct_advocate_argument("Test proposition", ["Evidence 1", "Evidence 2"])
    assert arg.stance == Stance.FOR
    assert arg.agent_id == "advocate"
    assert len(arg.evidence) == 2
    assert arg.score > 0


def test_construct_opponent_argument():
    adv = Argument(
        agent_id="advocate",
        stance=Stance.FOR,
        claim="test claim",
        evidence=["ev1"],
    )
    opp = construct_opponent_argument("Test proposition", adv, ["Counter 1"])
    assert opp.stance == Stance.AGAINST
    assert opp.rebuttal is not None


def test_judge_debate_tie():
    evidence = ["Point A", "Point B", "Point C"]
    adv = Argument(agent_id="advocate", stance=Stance.FOR, claim="X", evidence=evidence)
    opp = Argument(agent_id="opponent", stance=Stance.AGAINST, claim="Y", evidence=evidence)
    verdict = judge_debate(adv, opp)
    assert verdict.winner == "tie"
    assert verdict.advocate_score == verdict.opponent_score


def test_run_debate_full():
    verdict = run_debate(
        "Topic",
        ["Evidence for 1", "Evidence for 2"],
        ["Evidence against 1", "Evidence against 2"],
    )
    assert verdict.winner in ["advocate", "opponent", "tie"]
    assert 0.0 <= verdict.evidence_quality <= 1.0
    assert 0.0 <= verdict.logical_soundness <= 1.0


def test_debate_memory_store_retrieve():
    mem = DebateMemory()
    mem.store("test_key", "test_value")
    assert mem.retrieve("test_key") == "test_value"
    assert mem.retrieve("nonexistent") is None
```

## Dependencies

- None (standard library only)
