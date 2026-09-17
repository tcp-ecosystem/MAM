# -*- coding: utf-8 -*-
# ============================================================================
# MAM Auto-Generated Module
# ============================================================================
# Module Id:      auth-service-20260917-003
# Module Name:    auth-service
# Version:        1.0.0
# Author:         MAM Generator
# Created:        2026-09-17
# Description:    Authentication service with JWT tokens, OAuth2, sessions,
#                 RBAC, audit logging, password hashing, rate limiting,
#                 and token refresh.
# Python:         >=3.10
# Dependencies:   hashlib, hmac, os, json, time, uuid, logging, secrets,
#                 threading, base64, datetime
# License:        MIT
# ============================================================================
"""
auth-service.mam.py - Authentication Service

A production-grade authentication service implementing JWT-like token
management, OAuth2 flows, session storage, role-based access control,
comprehensive audit logging, secure password hashing (Argon2-like with
stdlib), rate limiting, and token refresh.

Usage:
    python auth-service.mam.py
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import math
import os
import secrets
import struct
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum, auto
from functools import wraps
from typing import Any, Callable, Optional

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logger = logging.getLogger("auth_service")
logger.setLevel(logging.DEBUG)

_handler = logging.StreamHandler()
_handler.setFormatter(
    logging.Formatter("[%(asctime)s] %(levelname)s %(name)s - %(message)s")
)
logger.addHandler(_handler)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class TokenType(Enum):
    ACCESS = "access"
    REFRESH = "refresh"
    ID = "id"


class GrantType(Enum):
    PASSWORD = "password"
    AUTHORIZATION_CODE = "authorization_code"
    CLIENT_CREDENTIALS = "client_credentials"
    REFRESH_TOKEN = "refresh_token"


class Permission(Enum):
    READ = "read"
    WRITE = "write"
    DELETE = "delete"
    ADMIN = "admin"
    MANAGE_USERS = "manage_users"
    MANAGE_ROLES = "manage_roles"
    VIEW_AUDIT = "view_audit"
    EXECUTE = "execute"


class AuditAction(Enum):
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILURE = "login_failure"
    LOGOUT = "logout"
    TOKEN_REFRESH = "token_refresh"
    TOKEN_REVOKE = "token_revoke"
    PASSWORD_CHANGE = "password_change"
    PASSWORD_RESET_REQUEST = "password_reset_request"
    PASSWORD_RESET_COMPLETE = "password_reset_complete"
    ROLE_ASSIGN = "role_assign"
    ROLE_REVOKE = "role_revoke"
    PERMISSION_GRANT = "permission_grant"
    PERMISSION_REVOKE = "permission_revoke"
    SESSION_CREATE = "session_create"
    SESSION_DESTROY = "session_destroy"
    ACCESS_GRANTED = "access_granted"
    ACCESS_DENIED = "access_denied"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class TokenClaims:
    """Claims embedded in a JWT-like token."""

    sub: str  # subject (user_id)
    iss: str = "auth-service"
    aud: str = "api"
    exp: float = 0.0
    iat: float = 0.0
    jti: str = ""
    token_type: str = "access"
    roles: list[str] = field(default_factory=list)
    scopes: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sub": self.sub,
            "iss": self.iss,
            "aud": self.aud,
            "exp": self.exp,
            "iat": self.iat,
            "jti": self.jti,
            "token_type": self.token_type,
            "roles": self.roles,
            "scopes": self.scopes,
            "metadata": self.metadata,
        }

    def is_expired(self) -> bool:
        return time.time() > self.exp

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TokenClaims":
        return cls(
            sub=data.get("sub", ""),
            iss=data.get("iss", "auth-service"),
            aud=data.get("aud", "api"),
            exp=data.get("exp", 0),
            iat=data.get("iat", 0),
            jti=data.get("jti", ""),
            token_type=data.get("token_type", "access"),
            roles=data.get("roles", []),
            scopes=data.get("scopes", []),
            metadata=data.get("metadata", {}),
        )


@dataclass
class User:
    """Represents a user account."""

    user_id: str
    username: str
    email: str
    password_hash: str
    salt: str
    roles: list[str] = field(default_factory=list)
    is_active: bool = True
    is_locked: bool = False
    failed_attempts: int = 0
    last_login: Optional[float] = None
    created_at: float = field(default_factory=time.time)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "email": self.email,
            "roles": self.roles,
            "is_active": self.is_active,
            "is_locked": self.is_locked,
            "last_login": self.last_login,
            "created_at": self.created_at,
        }


@dataclass
class Session:
    """An active user session."""

    session_id: str
    user_id: str
    created_at: float
    expires_at: float
    ip_address: str = ""
    user_agent: str = ""
    is_revoked: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    @property
    def is_valid(self) -> bool:
        return not self.is_expired and not self.is_revoked

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "is_valid": self.is_valid,
        }


@dataclass
class AuditEntry:
    """A single audit log entry."""

    entry_id: str
    timestamp: float
    action: AuditAction
    user_id: str
    ip_address: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    success: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "timestamp": self.timestamp,
            "datetime": datetime.fromtimestamp(self.timestamp, tz=timezone.utc).isoformat(),
            "action": self.action.value,
            "user_id": self.user_id,
            "ip_address": self.ip_address,
            "details": self.details,
            "success": self.success,
        }


@dataclass
class OAuth2Client:
    """Registered OAuth2 client."""

    client_id: str
    client_secret: str
    name: str
    redirect_uris: list[str] = field(default_factory=list)
    allowed_grants: list[GrantType] = field(default_factory=lambda: [GrantType.AUTHORIZATION_CODE])
    is_confidential: bool = True
    scopes: list[str] = field(default_factory=list)


@dataclass
class AuthorizationCode:
    """Short-lived authorization code for OAuth2 flows."""

    code: str
    client_id: str
    user_id: str
    redirect_uri: str
    scopes: list[str]
    expires_at: float
    code_challenge: str = ""
    code_challenge_method: str = ""

    @property
    def is_expired(self) -> bool:
        return time.time() > self.expires_at


# ---------------------------------------------------------------------------
# Password Hasher (scrypt + HMAC, Argon2-like)
# ---------------------------------------------------------------------------
class PasswordHasher:
    """
    Secure password hasher using scrypt (if available) with HMAC
    pepper and per-user salt.

    Falls back to PBKDF2-HMAC-SHA256 when scrypt is unavailable.
    """

    _PEPPER = "auth-service-pepper-change-in-production"
    _HASH_FUNC = "scrypt"

    @classmethod
    def _scrypt_hash(cls, password: str, salt: bytes) -> bytes:
        return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)

    @classmethod
    def _pbkdf2_hash(cls, password: str, salt: bytes) -> bytes:
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations=200_000)

    @classmethod
    def _hash(cls, password: str, salt: bytes) -> bytes:
        try:
            return cls._scrypt_hash(password, salt)
        except (AttributeError, ValueError):
            logger.debug("scrypt unavailable – falling back to PBKDF2")
            return cls._pbkdf2_hash(password, salt)

    @classmethod
    def hash_password(cls, password: str) -> tuple[str, str]:
        """Return ``(password_hash_hex, salt_hex)``."""
        salt = secrets.token_bytes(32)
        key = cls._hash(password, salt)
        peppered = hmac.new(cls._PEPPER.encode(), key, hashlib.sha256).digest()
        combined = key + peppered
        return combined.hex(), salt.hex()

    @classmethod
    def verify(cls, password: str, stored_hash: str, salt_hex: str) -> bool:
        """Return ``True`` if *password* matches the stored hash."""
        salt = bytes.fromhex(salt_hex)
        key = cls._hash(password, salt)
        peppered = hmac.new(cls._PEPPER.encode(), key, hashlib.sha256).digest()
        combined = key + peppered
        return hmac.compare_digest(combined.hex(), stored_hash)

    @classmethod
    def needs_rehash(cls, stored_hash: str) -> bool:
        """Heuristic: hashes shorter than 128 hex chars used older params."""
        return len(stored_hash) < 128


# ---------------------------------------------------------------------------
# JWT Token Manager
# ---------------------------------------------------------------------------
class TokenManager:
    """
    JWT-like token manager (HMAC-SHA256 signed, not RSA).

    Tokens are base64url-encoded JSON payloads signed with a server
    secret.  For production RSA/ECDSA support, extend with ``PyJWT``.
    """

    def __init__(
        self,
        secret: Optional[str] = None,
        access_ttl: int = 900,
        refresh_ttl: int = 604800,
    ) -> None:
        self._secret = secret or secrets.token_hex(32)
        self._access_ttl = access_ttl
        self._refresh_ttl = refresh_ttl
        self._revoked: set[str] = set()
        self._lock = threading.Lock()

    @staticmethod
    def _b64url_encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    @staticmethod
    def _b64url_decode(s: str) -> bytes:
        pad = 4 - len(s) % 4
        if pad != 4:
            s += "=" * pad
        return base64.urlsafe_b64decode(s)

    def _sign(self, payload: str) -> str:
        return self._b64url_encode(
            hmac.new(self._secret.encode(), payload.encode(), hashlib.sha256).digest()
        )

    def create_token(
        self,
        claims: TokenClaims,
        token_type: TokenType = TokenType.ACCESS,
    ) -> str:
        """Create and return a signed token string."""
        now = time.time()
        claims.iat = now
        claims.jti = uuid.uuid4().hex
        claims.token_type = token_type.value
        if token_type == TokenType.ACCESS:
            claims.exp = now + self._access_ttl
        elif token_type == TokenType.REFRESH:
            claims.exp = now + self._refresh_ttl
        else:
            claims.exp = now + self._access_ttl

        header = json.dumps({"alg": "HS256", "typ": "JWT"})
        body = json.dumps(claims.to_dict())
        encoded = f"{self._b64url_encode(header.encode())}.{self._b64url_encode(body.encode())}"
        signature = self._sign(encoded)
        return f"{encoded}.{signature}"

    def verify(self, token: str) -> TokenClaims:
        """
        Verify *token* signature and expiry, then return claims.

        Raises ``ValueError`` on any failure.
        """
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed token")

        encoded, signature = f"{parts[0]}.{parts[1]}", parts[2]
        expected = self._sign(encoded)
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid token signature")

        payload = json.loads(self._b64url_decode(parts[1]))
        claims = TokenClaims.from_dict(payload)

        if claims.is_expired():
            raise ValueError("Token expired")

        with self._lock:
            if claims.jti in self._revoked:
                raise ValueError("Token revoked")

        return claims

    def refresh(self, refresh_token: str) -> tuple[str, str]:
        """
        Validate a refresh token and return ``(new_access, new_refresh)``.

        The old refresh token is revoked.
        """
        claims = self.verify(refresh_token)
        if claims.token_type != "refresh":
            raise ValueError("Not a refresh token")

        self.revoke(refresh_token)

        new_access_claims = TokenClaims(
            sub=claims.sub,
            roles=claims.roles,
            scopes=claims.scopes,
            metadata=claims.metadata,
        )
        new_refresh_claims = TokenClaims(
            sub=claims.sub,
            roles=claims.roles,
            scopes=claims.scopes,
            metadata=claims.metadata,
        )
        new_access = self.create_token(new_access_claims, TokenType.ACCESS)
        new_refresh = self.create_token(new_refresh_claims, TokenType.REFRESH)
        return new_access, new_refresh

    def revoke(self, token: str) -> None:
        """Add the token's JTI to the revocation list."""
        try:
            claims = self.verify(token)
            with self._lock:
                self._revoked.add(claims.jti)
        except ValueError:
            pass

    def is_revoked(self, token: str) -> bool:
        try:
            claims = self.verify(token)
            with self._lock:
                return claims.jti in self._revoked
        except ValueError:
            return True

    @property
    def revoked_count(self) -> int:
        with self._lock:
            return len(self._revoked)


# ---------------------------------------------------------------------------
# Session Store
# ---------------------------------------------------------------------------
class SessionStore:
    """
    In-memory session store with TTL eviction.

    Thread-safe.
    """

    def __init__(self, default_ttl: int = 3600, max_sessions: int = 10000) -> None:
        self._sessions: dict[str, Session] = {}
        self._user_sessions: dict[str, set[str]] = {}
        self._default_ttl = default_ttl
        self._max_sessions = max_sessions
        self._lock = threading.Lock()

    def create(
        self,
        user_id: str,
        ip_address: str = "",
        user_agent: str = "",
        ttl: Optional[int] = None,
    ) -> Session:
        session = Session(
            session_id=uuid.uuid4().hex,
            user_id=user_id,
            created_at=time.time(),
            expires_at=time.time() + (ttl or self._default_ttl),
            ip_address=ip_address,
            user_agent=user_agent,
        )
        with self._lock:
            if len(self._sessions) >= self._max_sessions:
                self._evict()
            self._sessions[session.session_id] = session
            self._user_sessions.setdefault(user_id, set()).add(session.session_id)
        return session

    def get(self, session_id: str) -> Optional[Session]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            if session.is_expired:
                self._remove(session_id)
                return None
            return session

    def destroy(self, session_id: str) -> bool:
        with self._lock:
            return self._remove(session_id)

    def destroy_all_user(self, user_id: str) -> int:
        with self._lock:
            sids = self._user_sessions.pop(user_id, set())
            count = 0
            for sid in sids:
                self._sessions.pop(sid, None)
                count += 1
            return count

    def _remove(self, session_id: str) -> bool:
        session = self._sessions.pop(session_id, None)
        if session:
            user_sids = self._user_sessions.get(session.user_id, set())
            user_sids.discard(session_id)
            if not user_sids:
                self._user_sessions.pop(session.user_id, None)
            return True
        return False

    def _evict(self) -> None:
        expired = [
            sid for sid, s in self._sessions.items() if s.is_expired
        ]
        for sid in expired:
            self._remove(sid)
        if len(self._sessions) >= self._max_sessions:
            oldest = min(self._sessions, key=lambda s: self._sessions[s].created_at)
            self._remove(oldest)

    @property
    def active_count(self) -> int:
        with self._lock:
            return sum(1 for s in self._sessions.values() if s.is_valid)

    def list_user_sessions(self, user_id: str) -> list[Session]:
        with self._lock:
            sids = self._user_sessions.get(user_id, set())
            return [self._sessions[sid] for sid in sids if sid in self._sessions]


# ---------------------------------------------------------------------------
# RBAC Manager
# ---------------------------------------------------------------------------
class RBACManager:
    """
    Role-Based Access Control manager.

    Manages roles, permissions, and user-role assignments.
    """

    def __init__(self) -> None:
        self._roles: dict[str, set[Permission]] = {}
        self._user_roles: dict[str, set[str]] = {}
        self._lock = threading.Lock()

    def define_role(self, role_name: str, permissions: list[Permission]) -> None:
        with self._lock:
            self._roles[role_name] = set(permissions)

    def assign_role(self, user_id: str, role_name: str) -> bool:
        with self._lock:
            if role_name not in self._roles:
                return False
            self._user_roles.setdefault(user_id, set()).add(role_name)
            return True

    def revoke_role(self, user_id: str, role_name: str) -> bool:
        with self._lock:
            roles = self._user_roles.get(user_id, set())
            if role_name in roles:
                roles.discard(role_name)
                if not roles:
                    self._user_roles.pop(user_id, None)
                return True
            return False

    def get_user_roles(self, user_id: str) -> list[str]:
        with self._lock:
            return list(self._user_roles.get(user_id, set()))

    def get_role_permissions(self, role_name: str) -> list[str]:
        with self._lock:
            perms = self._roles.get(role_name, set())
            return [p.value for p in perms]

    def get_user_permissions(self, user_id: str) -> list[str]:
        with self._lock:
            roles = self._user_roles.get(user_id, set())
            perms: set[Permission] = set()
            for role in roles:
                perms.update(self._roles.get(role, set()))
            return [p.value for p in perms]

    def has_permission(self, user_id: str, permission: Permission) -> bool:
        perms = self.get_user_permissions(user_id)
        return permission.value in perms

    def has_any_permission(self, user_id: str, *permissions: Permission) -> bool:
        perms = set(self.get_user_permissions(user_id))
        return bool(perms & {p.value for p in permissions})

    def list_roles(self) -> dict[str, list[str]]:
        with self._lock:
            return {role: [p.value for p in perms] for role, perms in self._roles.items()}

    def list_user_assignments(self) -> dict[str, list[str]]:
        with self._lock:
            return {uid: list(roles) for uid, roles in self._user_roles.items()}


# ---------------------------------------------------------------------------
# OAuth2 Handler
# ---------------------------------------------------------------------------
class OAuth2Handler:
    """
    OAuth2 authorization server handler.

    Supports the Authorization Code grant (with optional PKCE) and
    Client Credentials grant.
    """

    def __init__(self, token_manager: TokenManager) -> None:
        self._token_manager = token_manager
        self._clients: dict[str, OAuth2Client] = {}
        self._auth_codes: dict[str, AuthorizationCode] = {}
        self._lock = threading.Lock()

    def register_client(
        self,
        client_id: str,
        client_secret: str,
        name: str,
        redirect_uris: Optional[list[str]] = None,
        allowed_grants: Optional[list[GrantType]] = None,
        scopes: Optional[list[str]] = None,
    ) -> OAuth2Client:
        client = OAuth2Client(
            client_id=client_id,
            client_secret=client_secret,
            name=name,
            redirect_uris=redirect_uris or [],
            allowed_grants=allowed_grants or [GrantType.AUTHORIZATION_CODE],
            scopes=scopes or [],
        )
        with self._lock:
            self._clients[client_id] = client
        return client

    def authorize(
        self,
        client_id: str,
        user_id: str,
        redirect_uri: str,
        scopes: list[str],
        code_challenge: str = "",
        code_challenge_method: str = "",
    ) -> str:
        """Issue an authorization code."""
        with self._lock:
            client = self._clients.get(client_id)
            if client is None:
                raise ValueError("Unknown client")
            if redirect_uri not in client.redirect_uris:
                raise ValueError("Invalid redirect URI")

        code = secrets.token_urlsafe(32)
        auth_code = AuthorizationCode(
            code=code,
            client_id=client_id,
            user_id=user_id,
            redirect_uri=redirect_uri,
            scopes=scopes,
            expires_at=time.time() + 600,  # 10 minutes
            code_challenge=code_challenge,
            code_challenge_method=code_challenge_method,
        )
        with self._lock:
            self._auth_codes[code] = auth_code
        return code

    def exchange_code(
        self,
        client_id: str,
        client_secret: str,
        code: str,
        code_verifier: str = "",
    ) -> tuple[str, str]:
        """Exchange an authorization code for (access_token, refresh_token)."""
        with self._lock:
            auth_code = self._auth_codes.pop(code, None)
        if auth_code is None:
            raise ValueError("Invalid authorization code")
        if auth_code.is_expired:
            raise ValueError("Authorization code expired")
        if auth_code.client_id != client_id:
            raise ValueError("Client mismatch")

        # PKCE verification
        if auth_code.code_challenge:
            if not code_verifier:
                raise ValueError("PKCE code_verifier required")
            if auth_code.code_challenge_method == "S256":
                digest = hashlib.sha256(code_verifier.encode()).digest()
                expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
            else:
                expected = code_verifier
            if not hmac.compare_digest(expected, auth_code.code_challenge):
                raise ValueError("PKCE verification failed")

        claims = TokenClaims(sub=auth_code.user_id, scopes=auth_code.scopes)
        access = self._token_manager.create_token(claims, TokenType.ACCESS)
        refresh_claims = TokenClaims(sub=auth_code.user_id, scopes=auth_code.scopes)
        refresh = self._token_manager.create_token(refresh_claims, TokenType.REFRESH)
        return access, refresh

    def client_credentials(
        self,
        client_id: str,
        client_secret: str,
        scopes: Optional[list[str]] = None,
    ) -> str:
        """Client Credentials grant – returns an access token."""
        with self._lock:
            client = self._clients.get(client_id)
        if client is None or client.client_secret != client_secret:
            raise ValueError("Invalid client credentials")
        claims = TokenClaims(sub=f"client:{client_id}", scopes=scopes or [])
        return self._token_manager.create_token(claims, TokenType.ACCESS)


# ---------------------------------------------------------------------------
# Audit Logger
# ---------------------------------------------------------------------------
class AuditLogger:
    """
    Structured audit logger with in-memory storage and query support.
    """

    def __init__(self, max_entries: int = 50000) -> None:
        self._entries: list[AuditEntry] = []
        self._max_entries = max_entries
        self._lock = threading.Lock()

    def log(
        self,
        action: AuditAction,
        user_id: str,
        ip_address: str = "",
        details: Optional[dict[str, Any]] = None,
        success: bool = True,
    ) -> AuditEntry:
        entry = AuditEntry(
            entry_id=uuid.uuid4().hex,
            timestamp=time.time(),
            action=action,
            user_id=user_id,
            ip_address=ip_address,
            details=details or {},
            success=success,
        )
        with self._lock:
            self._entries.append(entry)
            if len(self._entries) > self._max_entries:
                self._entries = self._entries[-self._max_entries // 2 :]
        logger.info(
            "AUDIT | %s | user=%s | success=%s | %s",
            action.value,
            user_id,
            success,
            json.dumps(details or {}),
        )
        return entry

    def query(
        self,
        user_id: Optional[str] = None,
        action: Optional[AuditAction] = None,
        since: Optional[float] = None,
        limit: int = 100,
    ) -> list[AuditEntry]:
        with self._lock:
            results = list(self._entries)
        if user_id:
            results = [e for e in results if e.user_id == user_id]
        if action:
            results = [e for e in results if e.action == action]
        if since:
            results = [e for e in results if e.timestamp >= since]
        return results[-limit:]

    @property
    def total_entries(self) -> int:
        with self._lock:
            return len(self._entries)


# ---------------------------------------------------------------------------
# Rate Limiter (sliding window)
# ---------------------------------------------------------------------------
class SlidingWindowRateLimiter:
    """
    Sliding-window rate limiter.

    Tracks timestamps of recent requests per client.  A request is
    rejected when the number of requests in the window exceeds
    ``max_requests``.
    """

    def __init__(self, max_requests: int = 60, window_seconds: int = 60) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._windows: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, client_id: str) -> bool:
        now = time.time()
        cutoff = now - self._window
        with self._lock:
            timestamps = self._windows.setdefault(client_id, [])
            # Evict expired
            self._windows[client_id] = [t for t in timestamps if t > cutoff]
            if len(self._windows[client_id]) < self._max:
                self._windows[client_id].append(now)
                return True
            return False

    def get_remaining(self, client_id: str) -> int:
        now = time.time()
        cutoff = now - self._window
        with self._lock:
            timestamps = [t for t in self._windows.get(client_id, []) if t > cutoff]
            return max(0, self._max - len(timestamps))

    def reset(self, client_id: str) -> None:
        with self._lock:
            self._windows.pop(client_id, None)


# ---------------------------------------------------------------------------
# Auth Service (orchestrator)
# ---------------------------------------------------------------------------
class AuthService:
    """
    Top-level authentication service that wires together all components.

    Provides a high-level API for registration, login, token management,
    and authorization checks.
    """

    def __init__(
        self,
        token_manager: Optional[TokenManager] = None,
        session_store: Optional[SessionStore] = None,
        rbac: Optional[RBACManager] = None,
        oauth2: Optional[OAuth2Handler] = None,
        audit: Optional[AuditLogger] = None,
        rate_limiter: Optional[SlidingWindowRateLimiter] = None,
    ) -> None:
        self.token_manager = token_manager or TokenManager()
        self.session_store = session_store or SessionStore()
        self.rbac = rbac or RBACManager()
        self.oauth2 = oauth2 or OAuth2Handler(self.token_manager)
        self.audit = audit or AuditLogger()
        self.rate_limiter = rate_limiter or SlidingWindowRateLimiter()
        self._users: dict[str, User] = {}
        self._lock = threading.Lock()

        # Seed default roles
        self.rbac.define_role("admin", list(Permission))
        self.rbac.define_role("user", [Permission.READ])
        self.rbac.define_role("editor", [Permission.READ, Permission.WRITE])
        self.rbac.define_role("moderator", [Permission.READ, Permission.WRITE, Permission.DELETE])

    # ---- user management ----

    def register(
        self,
        username: str,
        email: str,
        password: str,
        roles: Optional[list[str]] = None,
    ) -> User:
        """Register a new user and return the :class:`User` object."""
        with self._lock:
            for u in self._users.values():
                if u.username == username:
                    raise ValueError(f"Username '{username}' already taken")
                if u.email == email:
                    raise ValueError(f"Email '{email}' already registered")

        password_hash, salt = PasswordHasher.hash_password(password)
        user = User(
            user_id=uuid.uuid4().hex,
            username=username,
            email=email,
            password_hash=password_hash,
            salt=salt,
            roles=roles or ["user"],
        )
        with self._lock:
            self._users[user.user_id] = user

        for role in user.roles:
            self.rbac.assign_role(user.user_id, role)

        self.audit.log(AuditAction.LOGIN_SUCCESS, user.user_id, details={"event": "registered"})
        logger.info("User registered: %s (%s)", username, user.user_id)
        return user

    def login(
        self,
        username: str,
        password: str,
        ip_address: str = "",
    ) -> dict[str, Any]:
        """
        Authenticate and return ``{"access_token", "refresh_token", "session_id"}``.
        """
        if not self.rate_limiter.allow(f"login:{username}"):
            self.audit.log(
                AuditAction.LOGIN_FAILURE,
                username,
                ip_address=ip_address,
                details={"reason": "rate_limited"},
                success=False,
            )
            raise ValueError("Too many login attempts – try again later")

        user = self._find_user(username)
        if user is None:
            self.audit.log(
                AuditAction.LOGIN_FAILURE,
                username,
                ip_address=ip_address,
                details={"reason": "user_not_found"},
                success=False,
            )
            raise ValueError("Invalid credentials")

        if user.is_locked:
            self.audit.log(
                AuditAction.LOGIN_FAILURE,
                user.user_id,
                ip_address=ip_address,
                details={"reason": "account_locked"},
                success=False,
            )
            raise ValueError("Account is locked")

        if not PasswordHasher.verify(password, user.password_hash, user.salt):
            user.failed_attempts += 1
            if user.failed_attempts >= 5:
                user.is_locked = True
            self.audit.log(
                AuditAction.LOGIN_FAILURE,
                user.user_id,
                ip_address=ip_address,
                details={"reason": "wrong_password", "attempts": user.failed_attempts},
                success=False,
            )
            raise ValueError("Invalid credentials")

        # Success
        user.failed_attempts = 0
        user.last_login = time.time()

        claims = TokenClaims(
            sub=user.user_id,
            roles=user.roles,
            scopes=["openid", "profile", "email"],
        )
        access_token = self.token_manager.create_token(claims, TokenType.ACCESS)
        refresh_claims = TokenClaims(
            sub=user.user_id,
            roles=user.roles,
            scopes=["refresh"],
        )
        refresh_token = self.token_manager.create_token(refresh_claims, TokenType.REFRESH)

        session = self.session_store.create(
            user.user_id, ip_address=ip_address
        )

        self.audit.log(
            AuditAction.LOGIN_SUCCESS,
            user.user_id,
            ip_address=ip_address,
            details={"session_id": session.session_id},
        )

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "Bearer",
            "expires_in": self.token_manager._access_ttl,
            "session_id": session.session_id,
            "user": user.to_dict(),
        }

    def logout(self, session_id: str) -> None:
        session = self.session_store.get(session_id)
        if session:
            self.session_store.destroy(session_id)
            self.audit.log(
                AuditAction.LOGOUT,
                session.user_id,
                details={"session_id": session_id},
            )

    def refresh_tokens(self, refresh_token: str) -> dict[str, str]:
        new_access, new_refresh = self.token_manager.refresh(refresh_token)
        claims = self.token_manager.verify(new_access)
        self.audit.log(AuditAction.TOKEN_REFRESH, claims.sub)
        return {
            "access_token": new_access,
            "refresh_token": new_refresh,
        }

    def revoke_token(self, token: str) -> None:
        self.token_manager.revoke(token)
        try:
            claims = self.token_manager.verify(token)
            self.audit.log(AuditAction.TOKEN_REVOKE, claims.sub, details={"jti": claims.jti})
        except ValueError:
            pass

    def change_password(
        self,
        user_id: str,
        old_password: str,
        new_password: str,
    ) -> bool:
        user = self._get_user(user_id)
        if user is None:
            raise ValueError("User not found")
        if not PasswordHasher.verify(old_password, user.password_hash, user.salt):
            raise ValueError("Current password is incorrect")
        new_hash, new_salt = PasswordHasher.hash_password(new_password)
        user.password_hash = new_hash
        user.salt = new_salt
        self.audit.log(AuditAction.PASSWORD_CHANGE, user_id)
        # Invalidate all sessions
        self.session_store.destroy_all_user(user_id)
        return True

    def check_access(
        self,
        token: str,
        permission: Permission,
        ip_address: str = "",
    ) -> bool:
        try:
            claims = self.token_manager.verify(token)
        except ValueError:
            self.audit.log(
                AuditAction.ACCESS_DENIED,
                "anonymous",
                ip_address=ip_address,
                details={"reason": "invalid_token", "permission": permission.value},
                success=False,
            )
            return False

        if self.rbac.has_permission(claims.sub, permission):
            self.audit.log(
                AuditAction.ACCESS_GRANTED,
                claims.sub,
                ip_address=ip_address,
                details={"permission": permission.value},
            )
            return True

        self.audit.log(
            AuditAction.ACCESS_DENIED,
            claims.sub,
            ip_address=ip_address,
            details={"reason": "insufficient_permissions", "permission": permission.value},
            success=False,
        )
        return False

    # ---- helpers ----

    def _find_user(self, username: str) -> Optional[User]:
        with self._lock:
            for user in self._users.values():
                if user.username == username:
                    return user
        return None

    def _get_user(self, user_id: str) -> Optional[User]:
        with self._lock:
            return self._users.get(user_id)

    def get_user(self, user_id: str) -> Optional[dict[str, Any]]:
        user = self._get_user(user_id)
        return user.to_dict() if user else None

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            return [u.to_dict() for u in self._users.values()]

    def stats(self) -> dict[str, Any]:
        return {
            "total_users": len(self._users),
            "active_sessions": self.session_store.active_count,
            "revoked_tokens": self.token_manager.revoked_count,
            "audit_entries": self.audit.total_entries,
            "roles": self.rbac.list_roles(),
        }


# ---------------------------------------------------------------------------
# Monitoring Decorator
# ---------------------------------------------------------------------------
def monitor_auth(service: AuthService) -> Callable:
    """Decorator that logs auth operations with timing."""

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            try:
                result = func(*args, **kwargs)
                elapsed = (time.perf_counter() - start) * 1000
                logger.debug(
                    "auth.%s completed in %.2f ms",
                    func.__name__,
                    elapsed,
                )
                return result
            except Exception as exc:
                elapsed = (time.perf_counter() - start) * 1000
                logger.error(
                    "auth.%s failed after %.2f ms: %s",
                    func.__name__,
                    elapsed,
                    exc,
                )
                raise

        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# CLI demo
# ---------------------------------------------------------------------------
def _cli_demo() -> None:
    print("=" * 72)
    print(" Auth Service - Component Demo")
    print("=" * 72)

    auth = AuthService()

    # Register users
    print("\n[register] Creating users...")
    alice = auth.register("alice", "alice@example.com", "Str0ngP@ss!", roles=["admin", "user"])
    bob = auth.register("bob", "bob@example.com", "B0bSecure!", roles=["user"])
    charlie = auth.register("charlie", "charlie@example.com", "Ch@rlie123", roles=["editor"])
    print(f"   Alice  : {alice.user_id}")
    print(f"   Bob    : {bob.user_id}")
    print(f"   Charlie: {charlie.user_id}")

    # Login
    print("\n[login] Authenticating alice...")
    result = auth.login("alice", "Str0ngP@ss!", ip_address="192.168.1.100")
    access_token = result["access_token"]
    refresh_token = result["refresh_token"]
    session_id = result["session_id"]
    print(f"   Access token : {access_token[:50]}...")
    print(f"   Refresh token: {refresh_token[:50]}...")
    print(f"   Session      : {session_id}")

    # Access control
    print("\n[access] Checking permissions...")
    print(f"   alice READ  : {auth.check_access(access_token, Permission.READ)}")
    print(f"   alice WRITE : {auth.check_access(access_token, Permission.WRITE)}")
    print(f"   alice ADMIN : {auth.check_access(access_token, Permission.ADMIN)}")

    # Bob (read-only role)
    bob_result = auth.login("bob", "B0bSecure!", ip_address="10.0.0.5")
    bob_token = bob_result["access_token"]
    print(f"   bob    READ  : {auth.check_access(bob_token, Permission.READ)}")
    print(f"   bob    WRITE : {auth.check_access(bob_token, Permission.WRITE)}")
    print(f"   bob    ADMIN : {auth.check_access(bob_token, Permission.ADMIN)}")

    # Token refresh
    print("\n[refresh] Refreshing tokens...")
    new_tokens = auth.refresh_tokens(refresh_token)
    print(f"   New access : {new_tokens['access_token'][:50]}...")
    print(f"   New refresh: {new_tokens['refresh_token'][:50]}...")

    # Sessions
    print("\n[session] Active sessions:")
    for s in auth.session_store.list_user_sessions(alice.user_id):
        print(f"   {s.session_id} valid={s.is_valid}")

    # Password change
    print("\n[password] Alice changing password...")
    auth.change_password(alice.user_id, "Str0ngP@ss!", "N3wP@ssw0rd!")
    print("   Password changed – all sessions invalidated")
    print(f"   Active sessions: {auth.session_store.active_count}")

    # Failed login (rate limit)
    print("\n[rate-limit] Rapid failed logins...")
    for i in range(7):
        try:
            auth.login("alice", "wrong_password")
        except ValueError as e:
            print(f"   Attempt {i+1}: {e}")

    # RBAC details
    print("\n[rbac] Role definitions:")
    for role, perms in auth.rbac.list_roles().items():
        print(f"   {role:12s}: {perms}")
    print("\n[rbac] User assignments:")
    for uid, roles in auth.rbac.list_user_assignments().items():
        print(f"   {uid}: {roles}")

    # OAuth2 client
    print("\n[oauth2] Registering OAuth2 client...")
    auth.oauth2.register_client(
        client_id="my-app",
        client_secret="app-secret-123",
        name="My Application",
        redirect_uris=["http://localhost:3000/callback"],
        scopes=["openid", "profile"],
    )
    auth_code = auth.oauth2.authorize(
        client_id="my-app",
        user_id=alice.user_id,
        redirect_uri="http://localhost:3000/callback",
        scopes=["openid", "profile"],
    )
    print(f"   Authorization code: {auth_code[:20]}...")
    access, refresh = auth.oauth2.exchange_code(
        client_id="my-app",
        client_secret="app-secret-123",
        code=auth_code,
    )
    print(f"   OAuth2 access token: {access[:50]}...")

    # Audit log
    print("\n[audit] Recent audit entries:")
    for entry in auth.audit.query(limit=8):
        print(f"   [{entry.action.value:24s}] user={entry.user_id[:12]} success={entry.success}")

    # Stats
    print("\n[stats] Service statistics:")
    for k, v in auth.stats().items():
        print(f"   {k}: {v}")

    print("\n" + "=" * 72)
    print(" Demo complete.")
    print("=" * 72)


if __name__ == "__main__":
    _cli_demo()
