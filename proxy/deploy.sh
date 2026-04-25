#!/usr/bin/env bash
# =============================================================================
# VeevaVaultSearch — Deploy Lambda + API Gateway proxy
#
# Usage:
#   ./deploy.sh                          # deploy with defaults
#   ./deploy.sh --origin https://app.com # lock CORS to your UI domain
#   ./deploy.sh --region eu-west-1       # deploy to a specific region
#   ./deploy.sh --stack my-stack-name    # use a custom CloudFormation stack name
#   ./deploy.sh --destroy                # tear down the stack
#
# Prerequisites:
#   - AWS CLI  v2+  (https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
#   - AWS SAM CLI   (https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
#   - AWS credentials configured (aws configure, or env vars AWS_ACCESS_KEY_ID etc.)
#
# Free-tier note:
#   Lambda: 1M req/month + 400K GB-seconds (always free, no expiry)
#   HTTP API Gateway: 1M calls/month free for first 12 months
# =============================================================================
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
STACK_NAME="vault-search-proxy"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
S3_BUCKET=""           # SAM will create a managed bucket if left empty
ALLOWED_ORIGIN="*"     # Override with --origin for production
ALLOW_ANY_HOST="0"
REQUEST_TIMEOUT_MS="10000"
LOG_RETENTION_DAYS="30"
DESTROY=false

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack)    STACK_NAME="$2";          shift 2 ;;
    --region)   REGION="$2";             shift 2 ;;
    --origin)   ALLOWED_ORIGIN="$2";     shift 2 ;;
    --any-host) ALLOW_ANY_HOST="1";      shift   ;;
    --timeout)  REQUEST_TIMEOUT_MS="$2"; shift 2 ;;
    --destroy)  DESTROY=true;            shift   ;;
    *) error "Unknown argument: $1" ;;
  esac
done

# ── Change to proxy directory ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Destroy mode ─────────────────────────────────────────────────────────────
if $DESTROY; then
  warn "Deleting CloudFormation stack: $STACK_NAME in $REGION"
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  info "Waiting for stack deletion..."
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
  success "Stack deleted."
  exit 0
fi

# ── Prerequisite checks ───────────────────────────────────────────────────────
info "Checking prerequisites..."

if ! command -v aws &>/dev/null; then
  error "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
fi

if ! command -v sam &>/dev/null; then
  error "AWS SAM CLI not found. Install: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
fi

# Verify AWS credentials are configured
if ! aws sts get-caller-identity --region "$REGION" &>/dev/null; then
  error "AWS credentials not configured or expired. Run: aws configure"
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
success "AWS account: $AWS_ACCOUNT | Region: $REGION"

# ── CORS origin warning ────────────────────────────────────────────────────────
if [[ "$ALLOWED_ORIGIN" == "*" ]]; then
  warn "CORS is set to '*' (all origins). Use --origin https://yourdomain.com for production."
fi

# ── SAM build ─────────────────────────────────────────────────────────────────
info "Building Lambda package (sam build)..."
sam build \
  --template-file template.yaml \
  --region "$REGION"
success "Build complete."

# ── SAM deploy ───────────────────────────────────────────────────────────────
info "Deploying stack '$STACK_NAME' to $REGION..."

# Build the parameter overrides string
PARAMS="AllowedOrigin=${ALLOWED_ORIGIN}"
PARAMS="${PARAMS} AllowAnyHost=${ALLOW_ANY_HOST}"
PARAMS="${PARAMS} RequestTimeoutMs=${REQUEST_TIMEOUT_MS}"
PARAMS="${PARAMS} LogRetentionDays=${LOG_RETENTION_DAYS}"

sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides $PARAMS \
  --resolve-s3 \
  --no-fail-on-empty-changeset

# ── Print outputs ─────────────────────────────────────────────────────────────
echo ""
success "Deployment complete! Stack: $STACK_NAME"
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  VaultSearch Proxy Endpoints${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Extract outputs from CloudFormation
PROXY_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ProxyBaseUrl'].OutputValue" \
  --output text 2>/dev/null || echo "(unavailable)")

echo -e "  Proxy Base URL : ${GREEN}${PROXY_URL}${NC}"
echo -e "  Query endpoint : ${GREEN}${PROXY_URL}/query${NC}"
echo -e "  Auth endpoint  : ${GREEN}${PROXY_URL}/auth${NC}"
echo -e "  Health check   : ${GREEN}${PROXY_URL}/health${NC}"
echo ""
echo -e "${YELLOW}  Next step:${NC} Paste the Proxy Base URL into VaultSearch"
echo -e "  connect.html → 'Proxy URL' field."
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Quick health check ────────────────────────────────────────────────────────
if [[ -n "$PROXY_URL" && "$PROXY_URL" != "(unavailable)" ]]; then
  info "Running health check..."
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${PROXY_URL}/health" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" == "200" ]]; then
    success "Health check passed (HTTP 200)."
  else
    warn "Health check returned HTTP $HTTP_STATUS — give it 10s and retry: curl ${PROXY_URL}/health"
  fi
fi
