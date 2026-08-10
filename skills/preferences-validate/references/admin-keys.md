# API keys

**Required permission:** `admin:keys`
**Setup:** [setup-auth.md](setup-auth.md)

Create and manage Team API keys. Prefer the Dashboard when a person is creating
a key; agents may automate carefully.

## List keys

```bash
curl -sS "$PAI_API_BASE/admin/keys" "${CURL_AUTH[@]}" | python3 -m json.tool
```

## Create key

Plaintext key is returned **once**. Store immediately in a secret store / env var.

```bash
curl -sS -X POST "$PAI_API_BASE/admin/keys" \
  "${CURL_AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "agent-research",
    "scopes": [
      "balance:read",
      "scenario:read",
      "scenario:run",
      "scenario:estimate",
      "surveys:build",
      "surveys:create",
      "surveys:read",
      "surveys:update",
      "surveys:deploy",
      "surveys:suspend",
      "responses:read",
      "analytics:read",
      "analytics:run",
      "simulation:estimate",
      "simulation:run",
      "simulation:read"
    ]
  }' | python3 -m json.tool
```

Grant only the scopes the workflow needs. Full research recipes need the union of scenario + survey + simulation + balance scopes (see [combinations.md](combinations.md)).

## Update / revoke

```bash
# Update (e.g. scopes, label, expiry) — path param keyId
curl -sS -X PUT "$PAI_API_BASE/admin/keys/${KEY_ID}" \
  "${CURL_AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{ "label": "agent-research-v2" }' | python3 -m json.tool

# Revoke / delete
curl -sS -X DELETE "$PAI_API_BASE/admin/keys/${KEY_ID}" \
  "${CURL_AUTH[@]}" | python3 -m json.tool
```

## Safety

- Never log or commit plaintext keys
- Rotate on leak; revoked keys return `401 INVALID_API_KEY`
- Expired keys return `401 KEY_EXPIRED`
