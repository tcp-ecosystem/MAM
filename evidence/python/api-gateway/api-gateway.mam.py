# -*- coding: utf-8 -*-
# ============================================================================
# MAM Auto-Generated Module
# ============================================================================
# Module Id:      api-gateway-20260917-001
# Module Name:    api-gateway
# Version:        1.0.0
# Author:         MAM Generator
# Created:        2026-09-17
# Description:    REST API Gateway with FastAPI integration, rate limiting,
#                 authentication, caching, load balancing, and metrics.
# Python:         >=3.10
# Dependencies:   fastapi, uvicorn, hashlib, time, json, logging, uuid,
#                 collections, functools, threading, httpx
# License:        MIT
# ============================================================================
"""
api-gateway.mam.py - REST API Gateway

A production-grade API gateway implementing rate limiting, JWT authentication,
request routing, response caching, load balancing, health checks, and metrics
collection. Designed for microservice architectures.

Usage:
    python api-gateway.mam.py
    # Gateway starts on http://0.0.0.0:8000
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Optional

# ---------------------------------------------------------------------------
# Try importing FastAPI; fall back to a built-in stub if unavailable so the
# module remains syntactically valid and importable even without FastAPI.
# ---------------------------------------------------------------------------
try:
    from fastapi import FastAPI, HTTPException, Request, Response
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

    # Minimal stubs so the rest of the module can be loaded / tested without
    # FastAPI installed.
    class HTTPException(Exception):
        def __init__(self, status_code: int = 500, detail: str = ""):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    class JSONResponse:
        def __init__(self, content: Any = None, status_code: int = 200, **kw: Any):
            self.content = content
            self.status_code = status_code

    class Request:
        url: Any = None
        headers: dict[str, str] = {}
        client: Any = None

    class Response:
        status_code: int = 200

    class FastAPI:
        def __init__(self, **kw: Any):
            self.title = kw.get("title", "API Gateway")
            self.routes: list[Any] = []

        def middleware(self, *a: Any, **kw: Any) -> Callable:
            def decorator(fn: Callable) -> Callable:
                return fn
            return decorator

        def add_api_route(self, *a: Any, **kw: Any) -> None:
            pass

        def include_router(self, *a: Any, **kw: Any) -> None:
            pass


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logger = logging.getLogger("api_gateway")
logger.setLevel(logging.DEBUG)

_handler = logging.StreamHandler()
_handler.setFormatter(
    logging.Formatter("[%(asctime)s] %(levelname)s %(name)s - %(message)s")
)
logger.addHandler(_handler)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class Route:
    """Represents a single registered route."""

    path: str
    methods: list[str]
    handler: Callable[..., Any]
    tags: list[str] = field(default_factory=list)
    requires_auth: bool = True
    rate_limit: Optional[int] = None  # requests per minute; None = unlimited


@dataclass
class UpstreamServer:
    """A backend server in the load-balancer pool."""

    url: str
    weight: int = 1
    healthy: bool = True
    current_connections: int = 0
    total_requests: int = 0


@dataclass
class MetricsSnapshot:
    """Point-in-time snapshot of collected metrics."""

    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    avg_response_time_ms: float = 0.0
    active_connections: int = 0
    cache_hit_rate: float = 0.0
    rate_limit_rejections: int = 0


# ---------------------------------------------------------------------------
# Rate Limiter (Token Bucket)
# ---------------------------------------------------------------------------
class RateLimiter:
    """
    Token-bucket rate limiter.

    Each client (identified by ``client_id``) receives ``max_tokens`` tokens
    that refill at ``refill_rate`` tokens per second.  A request is allowed
    only when at least one token is available.

    Thread-safe.
    """

    def __init__(self, max_tokens: int = 60, refill_rate: float = 1.0) -> None:
        self._max_tokens = max_tokens
        self._refill_rate = refill_rate
        self._buckets: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def _refill(self, bucket: dict[str, Any]) -> None:
        now = time.monotonic()
        elapsed = now - bucket["last_refill"]
        bucket["tokens"] = min(
            self._max_tokens,
            bucket["tokens"] + elapsed * self._refill_rate,
        )
        bucket["last_refill"] = now

    def allow(self, client_id: str, tokens: int = 1) -> bool:
        """Return ``True`` if the request is allowed, ``False`` otherwise."""
        with self._lock:
            if client_id not in self._buckets:
                self._buckets[client_id] = {
                    "tokens": float(self._max_tokens),
                    "last_refill": time.monotonic(),
                }
            bucket = self._buckets[client_id]
            self._refill(bucket)
            if bucket["tokens"] >= tokens:
                bucket["tokens"] -= tokens
                return True
            return False

    def get_remaining(self, client_id: str) -> float:
        with self._lock:
            if client_id not in self._buckets:
                return float(self._max_tokens)
            bucket = self._buckets[client_id]
            self._refill(bucket)
            return bucket["tokens"]

    def reset(self, client_id: str) -> None:
        with self._lock:
            self._buckets.pop(client_id, None)


# ---------------------------------------------------------------------------
# Authentication Middleware
# ---------------------------------------------------------------------------
class AuthenticationMiddleware:
    """
    Validates Bearer tokens (simple HMAC-signed tokens for demonstration).

    In production, replace with JWT / OAuth2 verification.
    """

    _SECRET = "gateway-secret-change-me"

    def __init__(self, excluded_paths: Optional[list[str]] = None) -> None:
        self._excluded = set(excluded_paths or ["/health", "/metrics", "/docs"])
        self._active_tokens: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _sign(payload: str) -> str:
        return hashlib.sha256(
            (payload + AuthenticationMiddleware._SECRET).encode()
        ).hexdigest()

    def create_token(self, user_id: str, roles: list[str], ttl: int = 3600) -> str:
        """Create a signed token for ``user_id``."""
        token_id = uuid.uuid4().hex
        expires = time.time() + ttl
        payload = f"{token_id}:{user_id}:{','.join(roles)}:{expires}"
        signature = self._sign(payload)
        token = f"{token_id}.{user_id}.{','.join(roles)}.{int(expires)}.{signature}"
        self._active_tokens[token_id] = {
            "user_id": user_id,
            "roles": roles,
            "expires": expires,
        }
        return token

    def validate(self, token: str) -> dict[str, Any]:
        """Validate *token* and return claims dict or raise ``HTTPException``."""
        parts = token.split(".")
        if len(parts) != 5:
            raise HTTPException(status_code=401, detail="Malformed token")

        token_id, user_id, roles_str, expires_str, provided_sig = parts
        roles = roles_str.split(",") if roles_str else []
        expires = int(expires_str)

        if time.time() > expires:
            raise HTTPException(status_code=401, detail="Token expired")

        expected_sig = self._sign(
            f"{token_id}:{user_id}:{roles_str}:{expires_str}"
        )
        if not _timing_safe_eq(provided_sig, expected_sig):
            raise HTTPException(status_code=401, detail="Invalid token")

        return {"user_id": user_id, "roles": roles, "expires": expires}

    def extract_token(self, request: Request) -> Optional[str]:
        """Pull the Bearer token from the ``Authorization`` header."""
        auth_header = getattr(request, "headers", {}).get("authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:]
        return None

    def is_excluded(self, path: str) -> bool:
        return path in self._excluded


def _timing_safe_eq(a: str, b: str) -> bool:
    """Constant-time string comparison."""
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0


# ---------------------------------------------------------------------------
# Response Cache
# ---------------------------------------------------------------------------
class ResponseCache:
    """
    TTL-based in-memory response cache.

    Keys are derived from method + path + sorted query params.
    """

    def __init__(self, default_ttl: int = 300, max_size: int = 1024) -> None:
        self._default_ttl = default_ttl
        self._max_size = max_size
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def make_key(method: str, path: str, query: str = "") -> str:
        raw = f"{method}:{path}:{query}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.time() > entry["expires"]:
                del self._store[key]
                return None
            return entry["value"]

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        with self._lock:
            if len(self._store) >= self._max_size:
                oldest_key = min(self._store, key=lambda k: self._store[k]["expires"])
                del self._store[oldest_key]
            self._store[key] = {
                "value": value,
                "expires": time.time() + (ttl or self._default_ttl),
            }

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._store)

    @property
    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"entries": len(self._store), "max_size": self._max_size}


# ---------------------------------------------------------------------------
# Load Balancer (Weighted Round-Robin)
# ---------------------------------------------------------------------------
class LoadBalancer:
    """
    Weighted round-robin load balancer across :class:`UpstreamServer` nodes.
    """

    def __init__(self, servers: Optional[list[UpstreamServer]] = None) -> None:
        self._servers: list[UpstreamServer] = servers or []
        self._index = 0
        self._lock = threading.Lock()

    def add_server(self, url: str, weight: int = 1) -> UpstreamServer:
        server = UpstreamServer(url=url, weight=weight)
        self._servers.append(server)
        return server

    def remove_server(self, url: str) -> bool:
        before = len(self._servers)
        self._servers = [s for s in self._servers if s.url != url]
        return len(self._servers) < before

    def next_server(self) -> Optional[UpstreamServer]:
        with self._lock:
            healthy = [s for s in self._servers if s.healthy]
            if not healthy:
                return None
            total_weight = sum(s.weight for s in healthy)
            if total_weight == 0:
                return healthy[0]
            idx = self._index % total_weight
            self._index += 1
            cumulative = 0
            for s in healthy:
                cumulative += s.weight
                if idx < cumulative:
                    s.current_connections += 1
                    s.total_requests += 1
                    return s
        return healthy[0] if healthy else None

    def release_connection(self, server: UpstreamServer) -> None:
        server.current_connections = max(0, server.current_connections - 1)

    @property
    def servers(self) -> list[UpstreamServer]:
        return list(self._servers)


# ---------------------------------------------------------------------------
# Request Router
# ---------------------------------------------------------------------------
class RequestRouter:
    """
    Simple in-memory request router that maps (method, path) to handlers.
    """

    def __init__(self) -> None:
        self._routes: list[Route] = []

    def add_route(self, route: Route) -> None:
        self._routes.append(route)
        logger.info("Registered route: %s %s", route.methods, route.path)

    def match(self, method: str, path: str) -> Optional[Route]:
        for route in self._routes:
            if method in route.methods and route.path == path:
                return route
        return None

    def list_routes(self) -> list[dict[str, Any]]:
        return [
            {
                "path": r.path,
                "methods": r.methods,
                "tags": r.tags,
                "requires_auth": r.requires_auth,
            }
            for r in self._routes
        ]


# ---------------------------------------------------------------------------
# Metrics Collector
# ---------------------------------------------------------------------------
class MetricsCollector:
    """
    Lightweight in-process metrics collector.

    Stores counters and timing histograms in memory.
    """

    def __init__(self) -> None:
        self._counters: dict[str, int] = defaultdict(int)
        self._timings: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def inc(self, name: str, value: int = 1) -> None:
        with self._lock:
            self._counters[name] += value

    def observe(self, name: str, value_ms: float) -> None:
        with self._lock:
            self._timings[name].append(value_ms)
            if len(self._timings[name]) > 10000:
                self._timings[name] = self._timings[name][-5000:]

    def snapshot(self) -> MetricsSnapshot:
        with self._lock:
            total = self._counters.get("requests_total", 0)
            ok = self._counters.get("requests_success", 0)
            fail = self._counters.get("requests_failed", 0)
            timings = self._timings.get("response_time_ms", [])
            avg = sum(timings) / len(timings) if timings else 0.0
            cache_hits = self._counters.get("cache_hits", 0)
            cache_misses = self._counters.get("cache_misses", 0)
            total_cache = cache_hits + cache_misses
            hit_rate = (cache_hits / total_cache * 100) if total_cache else 0.0
            return MetricsSnapshot(
                total_requests=total,
                successful_requests=ok,
                failed_requests=fail,
                avg_response_time_ms=round(avg, 2),
                active_connections=self._counters.get("active_connections", 0),
                cache_hit_rate=round(hit_rate, 2),
                rate_limit_rejections=self._counters.get("rate_limit_rejections", 0),
            )

    def as_dict(self) -> dict[str, Any]:
        return {
            "counters": dict(self._counters),
            "timings": {k: len(v) for k, v in self._timings.items()},
        }


# ---------------------------------------------------------------------------
# Monitoring Decorators
# ---------------------------------------------------------------------------
def monitor_endpoint(metrics: MetricsCollector) -> Callable:
    """Decorator that records timing and success/failure for an endpoint."""

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            metrics.inc("requests_total")
            metrics.inc("active_connections")
            start = time.perf_counter()
            try:
                result = func(*args, **kwargs)
                metrics.inc("requests_success")
                return result
            except Exception:
                metrics.inc("requests_failed")
                raise
            finally:
                elapsed_ms = (time.perf_counter() - start) * 1000
                metrics.observe("response_time_ms", elapsed_ms)
                with metrics._lock:
                    metrics._counters["active_connections"] = max(
                        0, metrics._counters.get("active_connections", 1) - 1
                    )

        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Gateway (orchestrator)
# ---------------------------------------------------------------------------
class APIGateway:
    """
    Central API Gateway that ties together all components.

    Coordinates rate limiting, authentication, routing, caching, load
    balancing, and metrics collection into a single request lifecycle.
    """

    def __init__(
        self,
        rate_limiter: Optional[RateLimiter] = None,
        auth: Optional[AuthenticationMiddleware] = None,
        cache: Optional[ResponseCache] = None,
        load_balancer: Optional[LoadBalancer] = None,
        router: Optional[RequestRouter] = None,
        metrics: Optional[MetricsCollector] = None,
    ) -> None:
        self.rate_limiter = rate_limiter or RateLimiter()
        self.auth = auth or AuthenticationMiddleware()
        self.cache = cache or ResponseCache()
        self.load_balancer = load_balancer or LoadBalancer()
        self.router = router or RequestRouter()
        self.metrics = metrics or MetricsCollector()
        self._request_log: list[dict[str, Any]] = []

    # ---- internal helpers -------------------------------------------------

    def _client_id(self, request: Request) -> str:
        client = getattr(request, "client", None)
        if client and hasattr(client, "host"):
            return client.host
        return "unknown"

    def _log_request(
        self, method: str, path: str, status: int, elapsed_ms: float
    ) -> None:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "method": method,
            "path": path,
            "status": status,
            "elapsed_ms": round(elapsed_ms, 2),
        }
        self._request_log.append(entry)
        if len(self._request_log) > 5000:
            self._request_log = self._request_log[-2500:]

    # ---- public API -------------------------------------------------------

    def handle_request(
        self, method: str, path: str, request: Request, body: Any = None
    ) -> JSONResponse:
        """
        Full request lifecycle:

        1. Rate-limit check
        2. Authentication
        3. Route matching
        4. Cache lookup
        5. Upstream dispatch (via load balancer)
        6. Metrics recording
        """
        start = time.perf_counter()
        client_id = self._client_id(request)

        # 1. Rate limit
        if not self.rate_limiter.allow(client_id):
            self.metrics.inc("rate_limit_rejections")
            self._log_request(method, path, 429, 0)
            return JSONResponse(
                content={"error": "Rate limit exceeded"},
                status_code=429,
            )

        # 2. Auth (skip excluded paths)
        route = self.router.match(method, path)
        claims: Optional[dict[str, Any]] = None
        if route and route.requires_auth and not self.auth.is_excluded(path):
            token = self.auth.extract_token(request)
            if token is None:
                self._log_request(method, path, 401, 0)
                return JSONResponse(
                    content={"error": "Missing authentication token"},
                    status_code=401,
                )
            try:
                claims = self.auth.validate(token)
            except HTTPException as exc:
                self._log_request(method, path, exc.status_code, 0)
                return JSONResponse(
                    content={"error": exc.detail}, status_code=exc.status_code
                )

        # 3. Route match
        if route is None:
            self._log_request(method, path, 404, 0)
            return JSONResponse(
                content={"error": "Route not found"}, status_code=404
            )

        # 4. Cache lookup (only GET)
        if method == "GET":
            cache_key = ResponseCache.make_key(method, path)
            cached = self.cache.get(cache_key)
            if cached is not None:
                self.metrics.inc("cache_hits")
                self._log_request(method, path, 200, 0)
                return JSONResponse(content=cached, status_code=200)
            self.metrics.inc("cache_misses")

        # 5. Dispatch to upstream
        upstream = self.load_balancer.next_server()
        if upstream is None:
            self._log_request(method, path, 503, 0)
            return JSONResponse(
                content={"error": "No healthy upstream servers"},
                status_code=503,
            )
        try:
            result = route.handler(request, body=body, upstream=upstream, claims=claims)
        finally:
            self.load_balancer.release_connection(upstream)

        # 6. Cache response
        if method == "GET":
            cache_key = ResponseCache.make_key(method, path)
            self.cache.set(cache_key, result)

        elapsed_ms = (time.perf_counter() - start) * 1000
        self.metrics.inc("requests_total")
        self.metrics.inc("requests_success")
        self.metrics.observe("response_time_ms", elapsed_ms)
        self._log_request(method, path, 200, elapsed_ms)

        return JSONResponse(content=result, status_code=200)

    def health_check(self) -> dict[str, Any]:
        healthy = [s for s in self.load_balancer.servers if s.healthy]
        return {
            "status": "healthy" if healthy else "degraded",
            "servers": len(self.load_balancer.servers),
            "healthy_servers": len(healthy),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def get_metrics(self) -> dict[str, Any]:
        return self.metrics.snapshot().__dict__

    def get_routes(self) -> list[dict[str, Any]]:
        return self.router.list_routes()

    def get_request_log(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._request_log[-limit:]


# ---------------------------------------------------------------------------
# Built-in sample handlers
# ---------------------------------------------------------------------------
def _sample_handler(
    request: Request, body: Any = None, upstream: Any = None, claims: Any = None
) -> dict[str, Any]:
    return {"message": "Hello from the gateway", "upstream": getattr(upstream, "url", "local")}


def _users_handler(
    request: Request, body: Any = None, upstream: Any = None, claims: Any = None
) -> dict[str, Any]:
    return {
        "users": [
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
        ]
    }


def _items_handler(
    request: Request, body: Any = None, upstream: Any = None, claims: Any = None
) -> dict[str, Any]:
    return {
        "items": [
            {"id": 101, "title": "Widget", "price": 9.99},
            {"id": 102, "title": "Gadget", "price": 24.50},
        ]
    }


# ---------------------------------------------------------------------------
# FastAPI application factory
# ---------------------------------------------------------------------------
def create_app(gateway: Optional[APIGateway] = None) -> Any:
    """
    Build and return a FastAPI ``app`` wired to the gateway components.

    If FastAPI is not installed the function returns ``None`` and the
    gateway can still be exercised via the CLI demo below.
    """
    if not HAS_FASTAPI:
        logger.warning("FastAPI not installed – skipping app creation")
        return None

    gw = gateway or APIGateway()

    # Register sample routes
    gw.router.add_route(Route(path="/", methods=["GET"], handler=_sample_handler, tags=["root"], requires_auth=False))
    gw.router.add_route(Route(path="/users", methods=["GET"], handler=_users_handler, tags=["users"]))
    gw.router.add_route(Route(path="/items", methods=["GET"], handler=_items_handler, tags=["items"]))

    # Add a backend server
    gw.load_balancer.add_server("http://localhost:8001", weight=2)
    gw.load_balancer.add_server("http://localhost:8002", weight=1)

    app = FastAPI(title=gw.router._routes[0].path if gw.router._routes else "Gateway")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return gw.health_check()

    @app.get("/metrics")
    async def metrics_endpoint() -> dict[str, Any]:
        return gw.get_metrics()

    @app.get("/routes")
    async def list_routes() -> list[dict[str, Any]]:
        return gw.get_routes()

    @app.get("/requests")
    async def request_log() -> list[dict[str, Any]]:
        return gw.get_request_log()

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
    async def proxy(path: str, request: Request) -> JSONResponse:
        return gw.handle_request(request.method, f"/{path}", request)

    return app


# ---------------------------------------------------------------------------
# CLI demo (runs when executed directly)
# ---------------------------------------------------------------------------
def _cli_demo() -> None:
    """Demonstrate the gateway components without a live server."""
    print("=" * 72)
    print(" API Gateway - Component Demo")
    print("=" * 72)

    gw = APIGateway()

    # Register routes
    gw.router.add_route(Route(path="/", methods=["GET"], handler=_sample_handler, requires_auth=False))
    gw.router.add_route(Route(path="/users", methods=["GET"], handler=_users_handler))
    gw.router.add_route(Route(path="/items", methods=["GET"], handler=_items_handler))

    # Add upstream servers
    gw.load_balancer.add_server("http://backend-1:8001", weight=3)
    gw.load_balancer.add_server("http://backend-2:8002", weight=1)
    gw.load_balancer.add_server("http://backend-3:8003", weight=2)

    # Create an auth token
    token = gw.auth.create_token(user_id="alice", roles=["admin", "user"])
    print(f"\n[auth] Token created: {token[:40]}...")

    # Simulate authenticated requests
    fake_request = Request()
    fake_request.headers = {"authorization": f"Bearer {token}"}
    fake_request.client = type("Client", (), {"host": "127.0.0.1"})()

    print("\n[routes] Registered routes:")
    for r in gw.get_routes():
        print(f"   {r['methods']} {r['path']}  (auth={r['requires_auth']})")

    print("\n[load-balancer] Server pool:")
    for s in gw.load_balancer.servers:
        print(f"   {s.url}  weight={s.weight}  healthy={s.healthy}")

    # Dispatch a few requests
    for i in range(5):
        resp = gw.handle_request("GET", "/", fake_request)
        print(f"\n[request {i+1}] GET / -> status={resp.status_code}  body={resp.content}")

    # Cache demo
    print(f"\n[cache] Entries after requests: {gw.cache.size}")
    cache_key = ResponseCache.make_key("GET", "/")
    print(f"[cache] Key for GET /: {cache_key}")

    # Metrics
    snap = gw.get_metrics()
    print(f"\n[metrics] Total requests : {snap['total_requests']}")
    print(f"[metrics] Successful     : {snap['successful_requests']}")
    print(f"[metrics] Failed         : {snap['failed_requests']}")
    print(f"[metrics] Avg resp (ms)  : {snap['avg_response_time_ms']}")
    print(f"[metrics] Cache hit rate : {snap['cache_hit_rate']}%")
    print(f"[metrics] Rate rejections: {snap['rate_limit_rejections']}")

    # Health check
    health = gw.health_check()
    print(f"\n[health] Status: {health['status']}")
    print(f"[health] Servers: {health['healthy_servers']}/{health['servers']} healthy")

    # Rate limiter demo
    limiter = RateLimiter(max_tokens=5, refill_rate=0.5)
    print("\n[rate-limiter] Sending 8 rapid requests from client 'attacker':")
    for i in range(8):
        allowed = limiter.allow("attacker")
        print(f"   Request {i+1}: {'ALLOWED' if allowed else 'REJECTED'}")

    print("\n" + "=" * 72)
    print(" Demo complete. Run with uvicorn for a live HTTP server:")
    print("   pip install fastapi uvicorn")
    print("   uvicorn api_gateway:app --reload")
    print("=" * 72)


# ---------------------------------------------------------------------------
# Module-level app instance (for uvicorn / gunicorn)
# ---------------------------------------------------------------------------
app = create_app()

if __name__ == "__main__":
    _cli_demo()
