#!/bin/bash
# Twenty spike: headlessly create/get an admin session, workspace, and API key via /metadata GraphQL.
# Idempotent: re-running reuses the existing workspace instead of failing on "user already exists".
set -uo pipefail

API="${TWENTY_API:-http://127.0.0.1:8091}"
EMAIL="${SPIKE_EMAIL:-admin@tapdata.dev}"
PASSWORD="${SPIKE_PASSWORD:-TapSpike2026}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/app/twenty-deploy/spike-secrets.env}"

gql() { # gql <json-body> [bearer-token]
  local body="$1" bearer="${2:-}"
  if [ -n "$bearer" ]; then
    curl -sS --noproxy '*' -X POST "$API/metadata" \
      -H 'content-type: application/json' -H "Authorization: Bearer $bearer" -d "$body"
  else
    curl -sS --noproxy '*' -X POST "$API/metadata" \
      -H 'content-type: application/json' -d "$body"
  fi
}

# loginToken (from signUp / getLoginTokenFromCredentials) -> usable session access token
exchange() { # exchange <login-token>
  gql "{\"query\":\"mutation (\$loginToken: String!, \$origin: String!) { getAuthTokensFromLoginToken(loginToken: \$loginToken, origin: \$origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }\",\"variables\":{\"loginToken\":\"$1\",\"origin\":\"$API\"}}" \
    | jq -r '.data.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token // empty'
}

echo "== 1. session =="
RESP="$(gql '{"query":"mutation { signUp(email: \"'"$EMAIL"'\", password: \"'"$PASSWORD"'\") { tokens { accessOrWorkspaceAgnosticToken { token } } } }"}')"
TOKEN="$(echo "$RESP" | jq -r '.data.signUp.tokens.accessOrWorkspaceAgnosticToken.token // empty')"
NEED_WORKSPACE=1

if [ -z "$TOKEN" ]; then
  echo "signUp refused ($(echo "$RESP" | jq -r '.errors[0].extensions.subCode // "unknown"')) — signing in"
  RESP="$(gql "{\"query\":\"mutation (\$origin: String!) { getLoginTokenFromCredentials(email: \\\"$EMAIL\\\", password: \\\"$PASSWORD\\\", origin: \$origin) { loginToken { token } } }\",\"variables\":{\"origin\":\"$API\"}}")"
  LOGIN_TOKEN="$(echo "$RESP" | jq -r '.data.getLoginTokenFromCredentials.loginToken.token // empty')"
  [ -n "$LOGIN_TOKEN" ] || { echo "$RESP" | jq -c '.errors // .' | head -c 400; echo; exit 1; }
  TOKEN="$(exchange "$LOGIN_TOKEN")"
  [ -n "$TOKEN" ] || { echo "could not exchange login token"; exit 1; }
  NEED_WORKSPACE=0
else
  echo "workspace-less signup session acquired"
fi

if [ "$NEED_WORKSPACE" = "1" ]; then
  echo "== 2. create workspace =="
  RESP="$(gql '{"query":"mutation ($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { loginToken { token } workspace { id workspaceUrls { subdomainUrl } } } }","variables":{"input":{"displayName":"Tapdata Spike","subdomain":"tapdataspike"}}}' "$TOKEN")"
  echo "$RESP" | jq -c '{errors: (.errors // "none"), workspace: (.data.signUpInNewWorkspace.workspace)}'
  LOGIN_TOKEN="$(echo "$RESP" | jq -r '.data.signUpInNewWorkspace.loginToken.token // empty')"
  [ -n "$LOGIN_TOKEN" ] || exit 1
  TOKEN="$(exchange "$LOGIN_TOKEN")"
  [ -n "$TOKEN" ] || { echo "could not exchange workspace-creation token"; exit 1; }
fi

echo "== 3. workspace =="
RESP="$(gql '{"query":"query { currentWorkspace { id displayName } }"}' "$TOKEN")"
WORKSPACE_ID="$(echo "$RESP" | jq -r '.data.currentWorkspace.id // empty')"
echo "$RESP" | jq -c '{errors: (.errors // "none"), workspace: (.data.currentWorkspace)}'
[ -n "$WORKSPACE_ID" ] || { echo "no current workspace"; exit 1; }

echo "== 4. activate workspace (installs standard app: objects + roles) =="
RESP="$(gql '{"query":"mutation ($data: ActivateWorkspaceInput!) { activateWorkspace(data: $data) { id activationStatus } }","variables":{"data":{"displayName":"Tapdata Spike"}}}' "$TOKEN")"
echo "$RESP" | jq -c '{errors: (.errors // "none"), activation: (.data.activateWorkspace.activationStatus)}'

ROLE_ID=""
for attempt in $(seq 1 20); do
  ROLES="$(gql '{"query":"query { getApiKeyRoles { id label } }"}' "$TOKEN")"
  ROLE_ID="$(echo "$ROLES" | jq -r '.data.getApiKeyRoles[] | select(.label=="Admin") | .id' | head -1)"
  [ -n "$ROLE_ID" ] && break
  sleep 3
done
echo "role: ${ROLE_ID:-none} (after $attempt tries)"
[ -n "$ROLE_ID" ] || { echo "$ROLES" | jq -c '.errors // .' | head -c 400; echo; exit 1; }

echo "== 5. api key =="
EXPIRES="$(date -u -d '+180 days' +%Y-%m-%dT%H:%M:%S.000Z)"
RESP="$(gql "{\"query\":\"mutation (\$input: CreateApiKeyInput!) { createApiKey(input: \$input) { id name } }\",\"variables\":{\"input\":{\"name\":\"spike-cli\",\"expiresAt\":\"$EXPIRES\",\"roleId\":\"$ROLE_ID\"}}}" "$TOKEN")"
API_KEY_ID="$(echo "$RESP" | jq -r '.data.createApiKey.id // empty')"
[ -n "$API_KEY_ID" ] || { echo "$RESP" | jq -c '.errors // .' | head -c 400; echo; exit 1; }
RESP="$(gql "{\"query\":\"mutation { generateApiKeyToken(apiKeyId: \\\"$API_KEY_ID\\\", expiresAt: \\\"$EXPIRES\\\") { token } }\"}" "$TOKEN")"
API_KEY_TOKEN="$(echo "$RESP" | jq -r '.data.generateApiKeyToken.token // empty')"
[ -n "$API_KEY_TOKEN" ] || { echo "$RESP" | jq -c '.errors // .' | head -c 400; echo; exit 1; }

umask 077
cat > "$SECRETS_FILE" <<EOF
SPIKE_EMAIL=$EMAIL
SPIKE_PASSWORD=$PASSWORD
WORKSPACE_ID=$WORKSPACE_ID
API_KEY_ID=$API_KEY_ID
TWENTY_API_KEY=$API_KEY_TOKEN
EOF
echo "saved $SECRETS_FILE — workspace $WORKSPACE_ID, api key id $API_KEY_ID, token ${API_KEY_TOKEN:0:10}..."
