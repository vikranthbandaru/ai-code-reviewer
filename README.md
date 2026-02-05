# AI Code Reviewer for GitHub Pull Requests

A production-grade AI-powered code review system that automatically analyzes pull requests for security vulnerabilities, bugs, performance issues, and code quality problems.

## Features

-  **Security Analysis**: SQL injection, XSS, command injection, hardcoded secrets
-  **Bug Detection**: Null pointer dereferences, race conditions, logic errors
-  **Performance**: N+1 queries, memory leaks, inefficient algorithms
-  **Dependency Scanning**: CVE detection via OSV API
-  **AI-Powered**: Uses LLMs for deep code understanding
-  **Multi-Language**: TypeScript/JavaScript, Python, Go

## Architecture

```
┌──────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    GitHub    │───▶│  Webhook Server │───▶│   Job Queue     │
│  PR Webhook  │    │  (Verify + JWT) │    │   (Redis)       │
└──────────────┘    └─────────────────┘    └────────┬────────┘
                                                     │
                                                     ▼
┌──────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    GitHub    │◀───│  Review Poster  │◀───│  Reviewer       │
│   PR Review  │    │                 │    │  Worker         │
└──────────────┘    └─────────────────┘    └─────────────────┘
                                                     │
                           ┌─────────────────────────┼─────────────────────────┐
                           ▼                         ▼                         ▼
                    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
                    │   Static    │          │   LLM       │          │   CVE       │
                    │   Analysis  │          │   Analysis  │          │   Scanner   │
                    └─────────────┘          └─────────────┘          └─────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Python 3.10+ (for Python analysis tools)
- Go 1.22+ (for Go analysis tools)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ai-code-reviewer.git
cd ai-code-reviewer

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Configuration

1. Create a GitHub App with these permissions:
   - Contents: Read
   - Pull requests: Read & Write
   - Checks: Write (optional)
   - Metadata: Read
   
2. Subscribe to webhook events:
   - Pull request: opened, synchronize, reopened, ready_for_review

3. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `GITHUB_APP_ID` - Your GitHub App ID
- `GITHUB_PRIVATE_KEY` - Base64-encoded private key (or `GITHUB_PRIVATE_KEY_PATH`)
- `GITHUB_WEBHOOK_SECRET` - Webhook secret for signature verification
- `OPENAI_API_KEY` - OpenAI API key (or configure alternative provider)

### Running Locally

```bash
# Start with Docker Compose
cd infra/docker
docker-compose up

# Or run directly
pnpm dev
```

## Deployment Options

### Option 1: Docker Compose (Development)

```bash
cd infra/docker
docker-compose up -d
```

### Option 2: Kubernetes (Production)

```bash
# Apply Kubernetes manifests
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/secrets.yaml  # Edit with real values first!
kubectl apply -f infra/k8s/deployment-webhook.yaml
kubectl apply -f infra/k8s/deployment-worker.yaml
kubectl apply -f infra/k8s/service.yaml
kubectl apply -f infra/k8s/ingress.yaml
```

### Option 3: GitHub Actions (No Server Required)

The included `.github/workflows/ai-review.yml` runs the reviewer directly in GitHub Actions.

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_APP_ID` | GitHub App ID | Required |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (base64) | Required |
| `GITHUB_WEBHOOK_SECRET` | Webhook signature secret | Required |
| `LLM_PROVIDER` | `openai`, `azure`, `vllm`, `anthropic` | `openai` |
| `OPENAI_API_KEY` | OpenAI API key | Required for OpenAI |
| `MAX_INLINE_COMMENTS` | Maximum inline comments per review | `10` |
| `RISK_THRESHOLD` | Risk score to fail check (0-100) | `85` |
| `SEMGREP_RULES` | Semgrep rule configuration | `auto` |

## Static Analysis Tools

| Language | Tools |
|----------|-------|
| TypeScript/JavaScript | ESLint (if configured), Semgrep |
| Python | Ruff (if configured), Bandit, Semgrep |
| Go | go vet, staticcheck, gosec, Semgrep |

## Risk Scoring

Issues are scored based on:
- **Severity**: critical (15x), high (7x), medium (3x), low (1x)
- **Category**: security (4x), correctness (3x), dependency (2.5x), performance (2x), maintainability (1.5x), style (1x)
- **Confidence**: 0.0 - 1.0 multiplier

Final score is normalized to 0-100 range.

## API Schemas

### Issue Schema

```typescript
interface Issue {
  id: string;
  category: 'security' | 'correctness' | 'performance' | 'maintainability' | 'style' | 'dependency';
  subtype: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;  // 0-1
  file_path: string;
  line_start: number;
  line_end: number;
  message: string;     // max 900 chars
  evidence: string;
  suggested_fix?: string;
  cwe?: string;        // e.g., "CWE-89"
  owasp_tag?: string;
}
```

### ReviewOutput Schema

```typescript
interface ReviewOutput {
  risk_score: number;  // 0-100
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  inline_comments: Issue[];
  summary_markdown: string;  // max 4000 chars
  exec_summary_eli2: string;
  stats: {
    files_changed: number;
    issues_found: number;
    tools_run: string[];
    model_used: string;
    latency_ms: number;
  };
}
```
### Working Model Screenshots
<img width="2824" height="1610" alt="Screenshot 2026-02-04 200733" src="https://github.com/user-attachments/assets/e558c772-8148-49fa-bbd0-0bdfbfbd9547" />

<img width="2819" height="1579" alt="Screenshot 2026-02-04 200754" src="https://github.com/user-attachments/assets/85eb306c-762f-496e-8307-562a139f0985" />

AI Code Reviewer responding to the security vulnerabilities and code quality Issues from a test repo I pulled. This test repo contains intentionally added vulnerabilities for testing purposes.


<img width="2826" height="1561" alt="Screenshot 2026-02-04 200903" src="https://github.com/user-attachments/assets/4afbd5d2-34b2-414a-a3a4-6a8b04a9346a" />

### Working Demo Video Link
https://drive.google.com/file/d/15lt7YUutxI6DwR0BJjb1fhcLfrQcPlq1/view?usp=sharing 


Test vulnerabilities repo preview

## Development

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint code
pnpm lint

# Type check
pnpm typecheck
```

## Security

- All webhook payloads are verified using HMAC-SHA256 signatures
- Repository content is treated as untrusted (prompt injection defenses)
- No code is stored persistently (ephemeral processing only)
- Minimal GitHub permissions required

## License

MIT
