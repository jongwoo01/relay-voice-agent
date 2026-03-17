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
  JUDGE_PASSCODE or JUDGE_PASSCODE_SECRET
  JUDGE_TOKEN_SECRET or JUDGE_TOKEN_SECRET_SECRET

Supported database modes:
  1. Cloud SQL socket mode for Cloud Run runtime (recommended)
     CLOUD_SQL_CONNECTION_NAME
     CLOUD_SQL_DATABASE_NAME
     CLOUD_SQL_DATABASE_USER
     CLOUD_SQL_DATABASE_PASSWORD or CLOUD_SQL_DATABASE_PASSWORD_SECRET
     Migration strategy defaults to Cloud Run Job in this mode.
     Optional local fallback:
       MIGRATION_DATABASE_URL / MIGRATION_DATABASE_URL_SECRET
       or DATABASE_URL / DATABASE_URL_SECRET

  2. Legacy direct URL mode (fallback / local compatibility)
     DATABASE_URL or DATABASE_URL_SECRET

Optional:
  MIGRATION_STRATEGY=auto|cloud-run-job|local
  CLOUD_RUN_MIGRATION_JOB
  CLOUD_RUN_MIGRATION_TIMEOUT
  CLOUD_RUN_SERVICE_ACCOUNT
  MIGRATION_DATABASE_URL
  MIGRATION_DATABASE_URL_SECRET
  CLOUD_SQL_DATABASE_PORT
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

MIGRATION_STRATEGY="${MIGRATION_STRATEGY:-auto}"
CLOUD_RUN_MIGRATION_JOB="${CLOUD_RUN_MIGRATION_JOB:-${CLOUD_RUN_SERVICE}-migrate}"
CLOUD_RUN_MIGRATION_TIMEOUT="${CLOUD_RUN_MIGRATION_TIMEOUT:-10m}"

SOCKET_MODE=0
if [[ -n "${CLOUD_SQL_CONNECTION_NAME:-}" ]]; then
  SOCKET_MODE=1
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

if [[ ${SOCKET_MODE} -eq 1 ]]; then
  : "${CLOUD_SQL_DATABASE_NAME:?Set CLOUD_SQL_DATABASE_NAME when CLOUD_SQL_CONNECTION_NAME is used}"
  : "${CLOUD_SQL_DATABASE_USER:?Set CLOUD_SQL_DATABASE_USER when CLOUD_SQL_CONNECTION_NAME is used}"

  if [[ -z "${CLOUD_SQL_DATABASE_PASSWORD:-}" && -z "${CLOUD_SQL_DATABASE_PASSWORD_SECRET:-}" ]]; then
    echo "Set CLOUD_SQL_DATABASE_PASSWORD or CLOUD_SQL_DATABASE_PASSWORD_SECRET when CLOUD_SQL_CONNECTION_NAME is used." >&2
    exit 1
  fi

elif [[ -z "${DATABASE_URL:-}" && -z "${DATABASE_URL_SECRET:-}" ]]; then
  echo "Set DATABASE_URL or DATABASE_URL_SECRET." >&2
  exit 1
fi

case "${MIGRATION_STRATEGY}" in
  auto)
    if [[ ${SOCKET_MODE} -eq 1 ]]; then
      MIGRATION_STRATEGY="cloud-run-job"
    else
      MIGRATION_STRATEGY="local"
    fi
    ;;
  local|cloud-run-job)
    ;;
  *)
    echo "MIGRATION_STRATEGY must be one of: auto, local, cloud-run-job" >&2
    exit 1
    ;;
esac

if [[ "${MIGRATION_STRATEGY}" == "cloud-run-job" && ${SOCKET_MODE} -ne 1 ]]; then
  echo "MIGRATION_STRATEGY=cloud-run-job requires CLOUD_SQL_CONNECTION_NAME and Cloud SQL socket mode." >&2
  exit 1
fi

if [[ "${MIGRATION_STRATEGY}" == "local" && -z "${MIGRATION_DATABASE_URL:-}" && -z "${MIGRATION_DATABASE_URL_SECRET:-}" && -z "${DATABASE_URL:-}" && -z "${DATABASE_URL_SECRET:-}" ]]; then
  echo "Local migration strategy requires MIGRATION_DATABASE_URL / MIGRATION_DATABASE_URL_SECRET or DATABASE_URL / DATABASE_URL_SECRET." >&2
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
MIGRATION_ENV_VARS=()
MIGRATION_SECRETS=()

append_secret_or_env() {
  local key="$1"
  local value_name="$2"
  local secret_name="$3"
  local env_vars_name="${4:-ENV_VARS}"
  local secrets_name="${5:-SECRETS}"
  local value="${!value_name:-}"
  local secret="${!secret_name:-}"

  if [[ -n "${secret}" ]]; then
    eval "${secrets_name}+=(\"\${key}=\${secret}:latest\")"
    return
  fi

  if [[ -n "${value}" ]]; then
    eval "${env_vars_name}+=(\"\${key}=\${value}\")"
  fi
}

append_secret_or_env "JUDGE_PASSCODE" "JUDGE_PASSCODE" "JUDGE_PASSCODE_SECRET"
append_secret_or_env "JUDGE_TOKEN_SECRET" "JUDGE_TOKEN_SECRET" "JUDGE_TOKEN_SECRET_SECRET"
append_secret_or_env "GEMINI_API_KEY" "GEMINI_API_KEY" "GEMINI_API_KEY_SECRET"
append_secret_or_env "GOOGLE_API_KEY" "GOOGLE_API_KEY" "GOOGLE_API_KEY_SECRET"

if [[ ${SOCKET_MODE} -eq 1 ]]; then
  ENV_VARS+=(
    "PGHOST=/cloudsql/${CLOUD_SQL_CONNECTION_NAME}"
    "PGPORT=${CLOUD_SQL_DATABASE_PORT:-5432}"
    "PGDATABASE=${CLOUD_SQL_DATABASE_NAME}"
    "PGUSER=${CLOUD_SQL_DATABASE_USER}"
  )
  append_secret_or_env "PGPASSWORD" "CLOUD_SQL_DATABASE_PASSWORD" "CLOUD_SQL_DATABASE_PASSWORD_SECRET"

  MIGRATION_ENV_VARS+=(
    "PGHOST=/cloudsql/${CLOUD_SQL_CONNECTION_NAME}"
    "PGPORT=${CLOUD_SQL_DATABASE_PORT:-5432}"
    "PGDATABASE=${CLOUD_SQL_DATABASE_NAME}"
    "PGUSER=${CLOUD_SQL_DATABASE_USER}"
  )
  append_secret_or_env \
    "PGPASSWORD" \
    "CLOUD_SQL_DATABASE_PASSWORD" \
    "CLOUD_SQL_DATABASE_PASSWORD_SECRET" \
    "MIGRATION_ENV_VARS" \
    "MIGRATION_SECRETS"
else
  append_secret_or_env "DATABASE_URL" "DATABASE_URL" "DATABASE_URL_SECRET"
fi

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
echo "Migration strategy: ${MIGRATION_STRATEGY}"

gcloud config set project "${GCP_PROJECT_ID}" >/dev/null

TEMP_CLOUDBUILD_CONFIG="$(mktemp)"
cleanup() {
  rm -f "${TEMP_CLOUDBUILD_CONFIG}"
}
trap cleanup EXIT

cat >"${TEMP_CLOUDBUILD_CONFIG}" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -f
      - apps/agent-api/Dockerfile
      - -t
      - ${IMAGE_URI}
      - .
images:
  - ${IMAGE_URI}
EOF

build_container_image() {
  gcloud builds submit \
    --project "${GCP_PROJECT_ID}" \
    --config "${TEMP_CLOUDBUILD_CONFIG}" \
    .
}

run_local_migrations() {
  local migration_database_url
  migration_database_url="$(
    resolve_secret_or_env_value MIGRATION_DATABASE_URL MIGRATION_DATABASE_URL_SECRET || true
  )"

  if [[ -z "${migration_database_url}" ]]; then
    migration_database_url="$(resolve_secret_or_env_value DATABASE_URL DATABASE_URL_SECRET)"
  fi

  echo "Applying database migrations locally..."
  DATABASE_URL="${migration_database_url}" npm run db:migrate --workspace @agent/agent-api
}

run_cloud_run_job_migrations() {
  local job_exists=0
  local create_or_update_args=()

  if gcloud run jobs describe "${CLOUD_RUN_MIGRATION_JOB}" \
    --project "${GCP_PROJECT_ID}" \
    --region "${GCP_REGION}" \
    >/dev/null 2>&1; then
    job_exists=1
  fi

  create_or_update_args=(
    --project "${GCP_PROJECT_ID}"
    --region "${GCP_REGION}"
    --image "${IMAGE_URI}"
    --command npm
    --args run,db:migrate,--workspace,@agent/agent-api
    --tasks 1
    --max-retries 0
    --task-timeout "${CLOUD_RUN_MIGRATION_TIMEOUT}"
    --cpu 1
    --memory 512Mi
    --set-env-vars "$(IFS=,; echo "${MIGRATION_ENV_VARS[*]}")"
    --set-cloudsql-instances "${CLOUD_SQL_CONNECTION_NAME}"
  )

  if [[ -n "${CLOUD_RUN_SERVICE_ACCOUNT:-}" ]]; then
    create_or_update_args+=(--service-account "${CLOUD_RUN_SERVICE_ACCOUNT}")
  fi

  if [[ ${#MIGRATION_SECRETS[@]} -gt 0 ]]; then
    create_or_update_args+=(--set-secrets "$(IFS=,; echo "${MIGRATION_SECRETS[*]}")")
  fi

  if [[ ${job_exists} -eq 1 ]]; then
    echo "Updating Cloud Run migration job ${CLOUD_RUN_MIGRATION_JOB}..."
    gcloud run jobs update "${CLOUD_RUN_MIGRATION_JOB}" "${create_or_update_args[@]}"
  else
    echo "Creating Cloud Run migration job ${CLOUD_RUN_MIGRATION_JOB}..."
    gcloud run jobs create "${CLOUD_RUN_MIGRATION_JOB}" "${create_or_update_args[@]}"
  fi

  echo "Executing Cloud Run migration job ${CLOUD_RUN_MIGRATION_JOB}..."
  gcloud run jobs execute "${CLOUD_RUN_MIGRATION_JOB}" \
    --project "${GCP_PROJECT_ID}" \
    --region "${GCP_REGION}" \
    --wait
}

if [[ "${MIGRATION_STRATEGY}" == "local" ]]; then
  run_local_migrations
  build_container_image
else
  build_container_image
  run_cloud_run_job_migrations
fi

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

if [[ -n "${CLOUD_RUN_SERVICE_ACCOUNT:-}" ]]; then
  DEPLOY_ARGS+=(--service-account "${CLOUD_RUN_SERVICE_ACCOUNT}")
fi

if [[ ${SOCKET_MODE} -eq 1 ]]; then
  DEPLOY_ARGS+=(--add-cloudsql-instances "${CLOUD_SQL_CONNECTION_NAME}")
fi

gcloud "${DEPLOY_ARGS[@]}"

echo "Cloud Run deployment finished."
gcloud run services describe "${CLOUD_RUN_SERVICE}" \
  --project "${GCP_PROJECT_ID}" \
  --region "${GCP_REGION}" \
  --format='value(status.url)'
