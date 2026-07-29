---
id: api-gateway
version: 1.0.0
name: API Gateway with Rate Limiting
author: MAM Team
runtime: python
tags:
  - api
  - gateway
  - rate-limiting
  - auth
  - advanced
description: An API gateway system with rate limiting, authentication middleware, and request routing. Demonstrates tool-based architecture with network and execution permissions.
---

# API Gateway with Rate Limiting

## Purpose

A modular API gateway that enforces rate limits, authenticates incoming requests, and routes them to appropriate backend handlers. Each component is a distinct tool module with well-defined responsibilities and permissions.

## System Definition

module APIGateway

type:
    system

modules:
    - Gateway
    - RateLimiter
    - AuthMiddleware
    - Router

edges:
    Gateway -> AuthMiddleware
    AuthMiddleware -> RateLimiter
    RateLimiter -> Router

## Module: Gateway

module Gateway

type:
    tool

provider:
    python

role:
    Orchestrator

goal:
    Accept incoming HTTP requests and orchestrate the auth, rate-limit, and routing pipeline

permissions:
    network: inbound
    exec: true

capabilities:
    - receive-request
    - forward-request
    - return-response

## Module: RateLimiter

module RateLimiter

type:
    tool

provider:
    python

role:
    Throttling

goal:
    Enforce per-client rate limits using a sliding window algorithm and reject excess requests

permissions:
    filesystem: read
    exec: true

capabilities:
    - check-limit
    - record-request
    - get-remaining

## Module: AuthMiddleware

module AuthMiddleware

type:
    tool

provider:
    python

role:
    Authentication

goal:
    Validate bearer tokens and API keys, rejecting unauthenticated requests before they reach backend services

permissions:
    network: internet
    exec: true

capabilities:
    - validate-token
    - extract-claims
    - reject-unauthorized

## Module: Router

module Router

type:
    tool

provider:
    python

role:
    Routing

goal:
    Map incoming requests to backend handlers based on path, method, and versioning rules

permissions:
    network: internal
    exec: true

capabilities:
    - match-route
    - forward-to-backend
    - handle-not-found

## Policy: GatewayPolicy

module GatewayPolicy

type:
    policy

allow:
    - network.inbound
    - network.internal
    - filesystem.read
    - exec

deny:
    - shell.rm
    - filesystem.write
    - network.external

permissions:
    network: inbound, internal
    filesystem: read
    exec: true

## Python

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any
from enum import Enum
from collections import defaultdict
import time
import hashlib


class HTTPMethod(Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"


@dataclass
class Request:
    method: str
    path: str
    headers: Dict[str, str] = field(default_factory=dict)
    body: Optional[str] = None
    client_id: str = ""


@dataclass
class Response:
    status: int
    body: Any = None
    headers: Dict[str, str] = field(default_factory=dict)


@dataclass
class RateLimitConfig:
    max_requests: int = 100
    window_seconds: int = 60


@dataclass
class RouteEntry:
    method: str
    path: str
    handler: Callable
    version: str = "v1"


class RateLimiter:
    def __init__(self, config: Optional[RateLimitConfig] = None):
        self.config = config or RateLimitConfig()
        self._requests: Dict[str, List[float]] = defaultdict(list)

    def _cleanup(self, client_id: str) -> None:
        now = time.time()
        cutoff = now - self.config.window_seconds
        self._requests[client_id] = [
            ts for ts in self._requests[client_id] if ts > cutoff
        ]

    def check_limit(self, client_id: str) -> bool:
        self._cleanup(client_id)
        return len(self._requests[client_id]) < self.config.max_requests

    def record_request(self, client_id: str) -> None:
        self._requests[client_id].append(time.time())

    def get_remaining(self, client_id: str) -> int:
        self._cleanup(client_id)
        return max(
            0, self.config.max_requests - len(self._requests[client_id])
        )


class AuthMiddleware:
    def __init__(self, valid_tokens: Optional[Dict[str, str]] = None):
        self._tokens = valid_tokens or {}
        self._api_keys: Dict[str, str] = {}

    def register_token(self, token: str, client_id: str) -> None:
        self._tokens[token] = client_id

    def register_api_key(self, api_key: str, client_id: str) -> None:
        self._api_keys[api_key] = client_id

    def validate_token(self, token: str) -> Optional[str]:
        return self._tokens.get(token)

    def validate_api_key(self, api_key: str) -> Optional[str]:
        return self._api_keys.get(api_key)

    def authenticate(self, request: Request) -> Optional[str]:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            return self.validate_token(token)
        api_key = request.headers.get("X-API-Key", "")
        if api_key:
            return self.validate_api_key(api_key)
        return None


class Router:
    def __init__(self):
        self._routes: List[RouteEntry] = []

    def add_route(
        self,
        method: str,
        path: str,
        handler: Callable,
        version: str = "v1",
    ) -> None:
        self._routes.append(
            RouteEntry(method=method, path=path, handler=handler, version=version)
        )

    def match_route(self, request: Request) -> Optional[RouteEntry]:
        version = request.headers.get("API-Version", "v1")
        for route in self._routes:
            if (
                route.method == request.method
                and route.path == request.path
                and route.version == version
            ):
                return route
        return None

    def forward_to_backend(self, request: Request) -> Response:
        route = self.match_route(request)
        if route is None:
            return Response(status=404, body={"error": "Route not found"})
        try:
            result = route.handler(request)
            return Response(status=200, body=result)
        except Exception as e:
            return Response(status=500, body={"error": str(e)})


class APIGateway:
    def __init__(
        self,
        rate_config: Optional[RateLimitConfig] = None,
        valid_tokens: Optional[Dict[str, str]] = None,
    ):
        self.rate_limiter = RateLimiter(rate_config)
        self.auth = AuthMiddleware(valid_tokens)
        self.router = Router()

    def add_route(
        self,
        method: str,
        path: str,
        handler: Callable,
        version: str = "v1",
    ) -> None:
        self.router.add_route(method, path, handler, version)

    def handle_request(self, request: Request) -> Response:
        client_id = self.auth.authenticate(request)
        if client_id is None:
            return Response(
                status=401, body={"error": "Unauthorized"}
            )

        if not self.rate_limiter.check_limit(client_id):
            remaining = self.rate_limiter.get_remaining(client_id)
            return Response(
                status=429,
                body={"error": "Rate limit exceeded"},
                headers={"X-RateLimit-Remaining": str(remaining)},
            )

        self.rate_limiter.record_request(client_id)
        response = self.router.forward_to_backend(request)
        remaining = self.rate_limiter.get_remaining(client_id)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
```

## Examples

```python
def hello_handler(request: Request) -> dict:
    return {"message": "Hello, world!"}

def user_handler(request: Request) -> dict:
    return {"user": "alice", "role": "admin"}

gateway = APIGateway(
    rate_config=RateLimitConfig(max_requests=5, window_seconds=60),
    valid_tokens={"secret-token-123": "client-001"},
)
gateway.add_route("GET", "/api/hello", hello_handler)
gateway.add_route("GET", "/api/user", user_handler)

req = Request(
    method="GET",
    path="/api/hello",
    headers={"Authorization": "Bearer secret-token-123"},
)
resp = gateway.handle_request(req)
print(resp.status)    # 200
print(resp.body)      # {'message': 'Hello, world!'}
print(resp.headers["X-RateLimit-Remaining"])  # 4
```

## Tests

```python
def test_rate_limiter_allows_within_limit():
    rl = RateLimiter(RateLimitConfig(max_requests=3, window_seconds=60))
    assert rl.check_limit("client-1") is True
    rl.record_request("client-1")
    rl.record_request("client-1")
    assert rl.check_limit("client-1") is True
    rl.record_request("client-1")
    assert rl.check_limit("client-1") is False


def test_rate_limiter_remaining():
    rl = RateLimiter(RateLimitConfig(max_requests=10, window_seconds=60))
    assert rl.get_remaining("c1") == 10
    rl.record_request("c1")
    assert rl.get_remaining("c1") == 9


def test_auth_validate_token():
    auth = AuthMiddleware({"tok-abc": "user-1"})
    assert auth.validate_token("tok-abc") == "user-1"
    assert auth.validate_token("tok-bad") is None


def test_auth_api_key():
    auth = AuthMiddleware()
    auth.register_api_key("key-123", "user-2")
    assert auth.validate_api_key("key-123") == "user-2"


def test_authenticate_request():
    auth = AuthMiddleware({"my-token": "u1"})
    req = Request(
        method="GET",
        path="/test",
        headers={"Authorization": "Bearer my-token"},
    )
    assert auth.authenticate(req) == "u1"


def test_authenticate_no_token():
    auth = AuthMiddleware()
    req = Request(method="GET", path="/test")
    assert auth.authenticate(req) is None


def test_router_match():
    router = Router()
    router.add_route("GET", "/ping", lambda r: "pong")
    req = Request(method="GET", path="/ping")
    route = router.match_route(req)
    assert route is not None
    assert route.path == "/ping"


def test_router_no_match():
    router = Router()
    router.add_route("GET", "/ping", lambda r: "pong")
    req = Request(method="POST", path="/ping")
    assert router.match_route(req) is None


def test_gateway_full_flow():
    gw = APIGateway(
        rate_config=RateLimitConfig(max_requests=2, window_seconds=60),
        valid_tokens={"test-token": "c1"},
    )
    gw.add_route("GET", "/data", lambda r: {"data": 42})

    req = Request(
        method="GET",
        path="/data",
        headers={"Authorization": "Bearer test-token"},
    )
    resp = gw.handle_request(req)
    assert resp.status == 200
    assert resp.body == {"data": 42}


def test_gateway_unauthorized():
    gw = APIGateway(valid_tokens={"tok": "c1"})
    gw.add_route("GET", "/data", lambda r: {})
    req = Request(method="GET", path="/data")
    resp = gw.handle_request(req)
    assert resp.status == 401


def test_gateway_rate_limit_exceeded():
    gw = APIGateway(
        rate_config=RateLimitConfig(max_requests=1, window_seconds=60),
        valid_tokens={"tok": "c1"},
    )
    gw.add_route("GET", "/data", lambda r: {})
    req = Request(
        method="GET",
        path="/data",
        headers={"Authorization": "Bearer tok"},
    )
    gw.handle_request(req)
    resp = gw.handle_request(req)
    assert resp.status == 429
```

## Dependencies

- None (standard library only)
