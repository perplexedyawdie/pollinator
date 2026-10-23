# 🐝 Pollinator

Two study groups, two [Bee](https://www.bee.computer) wearables. Each person connects their Bee, picks the conversation from their study session, and Pollinator shows each of them **only what the other group did differently**:

- ⚠️ **Disagreements**: the two groups said incompatible things (both versions shown; Pollinator never decides who is right)
- 💡 **Different angles**: the other group explained something with an example, analogy or method you didn't use
- 🐝 **You didn't cover**: points and whole topics only the other group discussed
- ✅ **Action items**: to-dos the other group mentioned ("focus on photorespiration for the midterm")

Results download as Markdown or PDF.

## Run it locally (Podman or Docker)

Needs the Bee app with **Developer Mode** on (Settings → tap the app version 5 times) and a [Claude API key](https://console.anthropic.com).

```bash
cp .env.example .env        # then set CLAUDE_API_KEY in .env
podman compose up --build   # or: docker compose up --build
```

Open http://localhost:8787. Stop with `podman compose down` (add `-v` to also remove the data volume).

For development without a container: `npm install`, then `npm run dev`.

## Deploy to AWS (Terraform)

![Pollinator AWS architecture: CloudFront serves the page from S3 and forwards /api/* through API Gateway to a Lambda that runs the Bee CLI; an async worker Lambda calls the Claude API; job data lives in S3 for at most a day and secrets in SSM Parameter Store](docs/architecture.png)

Source: [`docs/architecture.svg`](docs/architecture.svg).

```bash
npm install && npm run build        # bundles the functions into dist/api.zip and dist/worker.zip
cd infra
terraform init
export TF_VAR_claude_api_key=sk-ant-...   # omit to use Amazon Bedrock instead
terraform plan
terraform apply                     # prints site_url
```

Re-run `npm run build && terraform apply` after code changes. Remove everything with `terraform destroy`.

**Cost:** everything is pay-per-use, so idle cost is close to zero. Each comparison costs a few cents in Claude API usage. API Gateway throttling (10 requests/s) and the account's Lambda concurrency limit cap what a burst of traffic can cost (optional per-function caps: `api_max_concurrency`, `worker_max_concurrency`). Use an IAM user or role rather than root credentials to deploy.

**Bedrock note:** Pollinator was built for Amazon Bedrock first, but on our hackathon account every model call (Claude and Amazon Nova alike) failed with `Error 002: Access to Bedrock models is not allowed for this account`. The Claude API is the default for now. The Bedrock path stays in the code (`src/pipeline/llm.ts`) and is used whenever no Claude API key is set.

## How it works

1. **Bee login, nothing stored.** "Connect Bee" runs `bee login` in a throwaway config folder and shows its link as a QR code. After you approve in the Bee app, the folder is encrypted (AES-256-GCM) and handed to your browser tab, which sends it back with each request. The server keeps no sessions or credentials. Picking a conversation copies only that transcript and signs the session out.
2. **Extract.** Each transcript becomes structured study notes: topics, points and action items. Every item must cite the transcript lines it came from, and anything without a valid citation is dropped. The model records what was said, even when it's wrong; it never adds its own knowledge.
3. **Compare.** A second model call lines up the two sets of notes and lists, by index, what's missing, conflicting or explained differently on each side.
4. **Render.** Each person's view is built deterministically from those indices, so the other group's points appear exactly as extracted.

Raw transcripts are deleted as soon as notes are extracted.

## Configuration

| Variable | Default | |
|---|---|---|
| `CLAUDE_API_KEY` | none | Claude API key. When unset, Amazon Bedrock is used instead. |
| `EXTRACT_MODEL` | `claude-haiku-5-5` | Model that turns each transcript into notes |
| `COMPARE_MODEL` | `claude-sonnet-5-5` | Model that compares the two sets of notes |
| `LLM_PROVIDER` | auto | `anthropic` or `bedrock` |

## Tests

```bash
npm test           # unit tests: merge/render, citation check, session sealing
npm run fixtures   # full pipeline on two synthetic transcripts (calls the model)
```

## Privacy

- Bee data is end-to-end encrypted and only its owner can read it. Pollinator only reads the one conversation each person picks, after they approve the login in the Bee app.
- No accounts, no stored credentials: sealed Bee sessions live in the browser tab and expire after 30 minutes. Picking a conversation signs that session out.
- Raw transcripts are deleted right after extraction. Results are kept only until the page downloads them (and expire from S3 after 1 day).
- Logs record only Bee command names and exit codes, never their output.
- `bee logout` clears the local session. Run `bee external-access` to see which services have accessed your Bee data.
