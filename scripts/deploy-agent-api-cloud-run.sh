#!/usr/bin/env bash
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required." >&2
  exit 1
fi

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Required environment variables:
  GCP_PROJECT_ID
  GCP_REGION
  CLOUD_RUN_SERVICE
  ARTIFACT_REGISTRY_REPO
  GOOGLE_CLOUD_LOCATION

Required for live auth:
  Either GEMINI_API_KEY or GOOGLE_API_KEY
  Or GEMINI_API_KEY_SECRET / GOOGLE_API_KEY_SECRET

Required for persistence and judge auth:
  DATABASE_URL or DATABASE_URL_SECRET
  JUDGE_PASSCODE or JUDGE_PASSCODE_SECRET
  JUDGE_TOKEN_SECRET or JUDGE_TOKEN_SECRET_SECRET

Optional:
  GOOGLE_GENAI_API_VERSION
  LIVE_MODEL
  GEMINI_TASK_ROUTING_MODEL
  GEMINI_TASK_INTAKE_MODEL
  GEMINI_INTENT_MODEL
  JUDGE_USER_EMAIL
  JUDGE_USER_DISPLAY_NAME
  JUDGE_SESSION_TTL_SECONDS
EOF
  exit 0
fi

: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
: "${GCP_REGION:?Set GCP_REGION}"
: "${CLOUD_RUN_SERVICE:?Set CLOUD_RUN_SERVICE}"
: "${ARTIFACT_REGISTRY_REPO:?Set ARTIFACT_REGISTRY_REPO}"
: "${GOOGLE_CLOUD_LOCATION:?Set GOOGLE_CLOUD_LOCATION}"

if [[ -z "${DATABASE_URL:-}" && -z "${DATABASE_URL_SECRET:-}" ]]; then
  echo "Set DATABASE_URL or DATABASE_URL_SECRET." >&2
  exit 1
fi

if [[ -z "${JUDGE_PASSCODE:-}" && -z "${JUDGE_PASSCODE_SECRET:-}" ]]; then
  echo "Set JUDGE_PASSCODE or JUDGE_PASSCODE_SECRET." >&2
  exit 1
fi

if [[ -z "${JUDGE_TOKEN_SECRET:-}" && -z "${JUDGE_TOKEN_SECRET_SECRET:-}" ]]; then
  echo "Set JUDGE_TOKEN_SECRET or JUDGE_TOKEN_SECRET_SECRET." >&2
  exit 1
fi

if [[ -z "${GEMINI_API_KEY:-}" && -z "${GOOGLE_API_KEY:-}" && -z "${GEMINI_API_KEY_SECRET:-}" && -z "${GOOGLE_API_KEY_SECRET:-}" ]]; then
  echo "Set GEMINI_API_KEY / GOOGLE_API_KEY or their secret names." >&2
  exit 1
fi

IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/${CLOUD_RUN_SERVICE}:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

ENV_VARS=(
  "GOOGLE_CLOUD_PROJECT=${GCP_PROJECT_ID}"
  "GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION}"
  "GOOGLE_GENAI_API_VERSION=${GOOGLE_GENAI_API_VERSION:-v1}"
  "LIVE_MODEL=${LIVE_MODEL:-}"
  "GEMINI_TASK_ROUTING_MODEL=${GEMINI_TASK_ROUTING_MODEL:-}"
  "GEMINI_TASK_INTAKE_MODEL=${GEMINI_TASK_INTAKE_MODEL:-}"
  "GEMINI_INTENT_MODEL=${GEMINI_INTENT_MODEL:-}"
  "JUDGE_USER_EMAIL=${JUDGE_USER_EMAIL:-judge@gemini-live-agent.local}"
  "JUDGE_USER_DISPLAY_NAME=${JUDGE_USER_DISPLAY_NAME:-Judge}"
  "JUDGE_SESSION_TTL_SECONDS=${JUDGE_SESSION_TTL_SECONDS:-21600}"
)

SECRETS=()

append_secret_or_env() {
  local key="$1"
  local value_name="$2"
  local secret_name="$3"
  local value="${!value_name:-}"
  local secret="${!secret_name:-}"

  if [[ -n "${secret}" ]]; then
    SECRETS+=("${key}=${secret}:latest")
    return
  fi

  if [[ -n "${value}" ]]; then
    ENV_VARS+=("${key}=${value}")
  fi
}

append_secret_or_env "DATABASE_URL" "DATABASE_URL" "DATABASE_URL_SECRET"
append_secret_or_env "JUDGE_PASSCODE" "JUDGE_PASSCODE" "JUDGE_PASSCODE_SECRET"
append_secret_or_env "JUDGE_TOKEN_SECRET" "JUDGE_TOKEN_SECRET" "JUDGE_TOKEN_SECRET_SECRET"
append_secret_or_env "GEMINI_API_KEY" "GEMINI_API_KEY" "GEMINI_API_KEY_SECRET"
append_secret_or_env "GOOGLE_API_KEY" "GOOGLE_API_KEY" "GOOGLE_API_KEY_SECRET"

resolve_secret_or_env_value() {
  local value_name="$1"
  local secret_name="$2"
  local value="${!value_name:-}"
  local secret="${!secret_name:-}"

  if [[ -n "${value}" ]]; then
    printf '%s' "${value}"
    return
  fi

  if [[ -n "${secret}" ]]; then
    gcloud secrets versions access latest --secret "${secret}"
    return
  fi

  return 1
}

echo "Project: ${GCP_PROJECT_ID}"
echo "Region: ${GCP_REGION}"
echo "Service: ${CLOUD_RUN_SERVICE}"
echo "Image: ${IMAGE_URI}"

gcloud config set project "${GCP_PROJECT_ID}" >/dev/null

MIGRATION_DATABASE_URL="$(resolve_secret_or_env_value DATABASE_URL DATABASE_URL_SECRET)"
echo "Applying database migrations..."
DATABASE_URL="${MIGRATION_DATABASE_URL}" npm run db:migrate --workspace @agent/agent-api

gcloud builds submit \
  --project "${GCP_PROJECT_ID}" \
  --tag "${IMAGE_URI}" \
  --file "apps/agent-api/Dockerfile" \
  .

DEPLOY_ARGS=(
  run deploy "${CLOUD_RUN_SERVICE}"
  --project "${GCP_PROJECT_ID}"
  --region "${GCP_REGION}"
  --platform managed
  --allow-unauthenticated
  --image "${IMAGE_URI}"
  --cpu 1
  --memory 1Gi
  --min-instances 0
  --max-instances 5
  --port 8080
  --set-env-vars "$(IFS=,; echo "${ENV_VARS[*]}")"
)

if [[ ${#SECRETS[@]} -gt 0 ]]; then
  DEPLOY_ARGS+=(--set-secrets "$(IFS=,; echo "${SECRETS[*]}")")
fi

gcloud "${DEPLOY_ARGS[@]}"

echo "Cloud Run deployment finished."
gcloud run services describe "${CLOUD_RUN_SERVICE}" \
  --project "${GCP_PROJECT_ID}" \
  --region "${GCP_REGION}" \
  --format='value(status.url)'
