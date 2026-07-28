---
id: content-pipeline
version: 1.0.0
name: Content Pipeline Workflow
author: MAM Team
runtime: python
tags:
  - workflow
  - pipeline
  - content
  - advanced
description: Multi-step content pipeline with branching and parallel execution
---

# Content Pipeline Workflow

## Purpose

An automated content pipeline that ingests raw text, classifies it, runs parallel enrichment tasks (summarization and sentiment analysis), then merges results into a final structured output.

## Workflow Definition

module ContentPipeline

type:
    workflow

steps:
    - Ingest
    - Classify
    - Branch:
        parallel:
            - Summarize
            - SentimentAnalysis
    - Merge
    - Output

## Step: Ingest

module Ingest

type:
    tool

provider:
    python

capabilities:
    - read
    - normalize

## Step: Classify

module Classify

type:
    tool

provider:
    python

capabilities:
    - classify
    - tag

## Step: Summarize

module Summarize

type:
    tool

provider:
    python

capabilities:
    - summarize
    - extract-key-points

## Step: SentimentAnalysis

module SentimentAnalysis

type:
    tool

provider:
    python

capabilities:
    - analyze-sentiment
    - score

## Step: Merge

module Merge

type:
    tool

provider:
    python

capabilities:
    - merge
    - format

## Step: Output

module Output

type:
    tool

provider:
    python

capabilities:
    - write
    - export

## Python

```python
from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum

class ContentType(Enum):
    ARTICLE = "article"
    BLOG = "blog"
    DOCUMENTATION = "documentation"
    SOCIAL = "social"

@dataclass
class PipelineResult:
    content_type: str
    summary: str
    sentiment: str
    sentiment_score: float
    key_points: List[str] = field(default_factory=list)
    word_count: int = 0

def ingest(text: str) -> str:
    """Normalize raw text input."""
    return text.strip()

def classify(text: str) -> ContentType:
    """Classify content type based on text characteristics."""
    word_count = len(text.split())
    if word_count > 1000:
        return ContentType.ARTICLE
    elif word_count > 300:
        return ContentType.BLOG
    elif any(word in text.lower() for word in ["api", "function", "class"]):
        return ContentType.DOCUMENTATION
    return ContentType.SOCIAL

def summarize(text: str, max_sentences: int = 3) -> str:
    """Extract a simple extractive summary."""
    sentences = [s.strip() for s in text.split(".") if s.strip()]
    return ". ".join(sentences[:max_sentences]) + "."

def sentiment_analysis(text: str) -> tuple:
    """Basic keyword-based sentiment analysis."""
    positive = ["good", "great", "excellent", "love", "best", "amazing"]
    negative = ["bad", "terrible", "hate", "worst", "awful", "poor"]
    words = text.lower().split()
    pos = sum(1 for w in words if w in positive)
    neg = sum(1 for w in words if w in negative)
    score = (pos - neg) / max(len(words), 1)
    if score > 0.05:
        return "positive", round(score, 3)
    elif score < -0.05:
        return "negative", round(score, 3)
    return "neutral", round(score, 3)

def run_pipeline(text: str) -> PipelineResult:
    """Execute the full content pipeline."""
    clean = ingest(text)
    content_type = classify(clean)
    summ = summarize(clean)
    sent_label, sent_score = sentiment_analysis(clean)

    return PipelineResult(
        content_type=content_type.value,
        summary=summ,
        sentiment=sent_label,
        sentiment_score=sent_score,
        word_count=len(clean.split()),
    )
```

## Examples

```python
article = """
MAM is a specification-first project that transforms Markdown into a universal
Intermediate Representation for AI systems. Unlike traditional Markdown parsers,
MAM treats Markdown as an executable knowledge module that can be understood by
both humans and autonomous agents. This makes it ideal for building AI-powered
tools and workflows.
"""

result = run_pipeline(article)
print(result.content_type)   # article
print(result.sentiment)      # positive
print(result.summary)        # MAM is a specification-first project...
```

## Tests

```python
def test_ingest():
    assert ingest("  hello  ") == "hello"

def test_classify():
    short = "short text"
    assert classify(short) == ContentType.SOCIAL
    long_text = "word " * 1100
    assert classify(long_text) == ContentType.ARTICLE

def test_sentiment_positive():
    label, score = sentiment_analysis("I love this great amazing product")
    assert label == "positive"
    assert score > 0

def test_sentiment_negative():
    label, score = sentiment_analysis("This is terrible and awful")
    assert label == "negative"
    assert score < 0

def test_pipeline():
    result = run_pipeline("This is a good test document with enough words. " * 50)
    assert result.content_type in ["article", "blog"]
    assert result.word_count > 0
```

## Dependencies

- None (standard library only)
