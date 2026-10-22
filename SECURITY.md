# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's advisory form:
https://github.com/hellpuffyt/modelharbor/security/advisories/new

Do not open a public issue for a suspected vulnerability, and never include a
real provider API key in a report.

## Scope

ModelHarbor holds LLM provider API keys and can spend money with them. In
scope: any path by which a key reaches the browser, a log or an API response;
any way for a party other than the operator to trigger `POST /api/route`
(cross-site requests, unexpected network exposure); resource exhaustion of the
server.

The server has no authentication. It binds `127.0.0.1` by default; exposing it
with `HOST` is only safe behind your own authenticating proxy.

## Supported versions

Only the latest commit on `main` is supported.
