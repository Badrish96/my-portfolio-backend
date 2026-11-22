# Job matching architecture

The Chrome scanner extracts listings and sends up to 50 per request to `POST /api/jobs/import`. The service validates posting URLs and fields, reconciles duplicates, then scores the canonical jobs. Adzuna and company career discovery use the same persistence and scoring path. The dashboard uses `GET /api/jobs?includeReview=true` for both views. Existing clients can request `visibility=review` separately.

## Evidence and ranking

The account profile supplies skills, preferred roles and locations, relevant years of experience, salary expectations, and resume/project evidence. The existing owner profile defaults include frontend/full-stack skills, five years of relevant experience, and Gurugram, India remote, and Delhi NCR preferences. Saved profile fields take precedence. Salary is compared in annual INR when enough data is available.

Rules award up to 25 points each for role and skills, 20 for responsibilities, 15 for experience, 10 for location, and 5 for compensation. Section markers, aliases, and responsibility patterns distinguish mandatory gaps, optional skills, and incidental mentions. Role and experience mismatches cap the score. Categories start at 90, 75, 60, and 40. The recommendation cutoff defaults to 60 and can be set with `JOB_MIN_MATCH_SCORE`.

Borderline jobs with adequate description text and a rule score from 50 through 84 can receive contextual evaluation. The service ranks resume, experience, project, education, and certification chunks by term and canonical skill overlap. It retrieves up to four chunks for the model. Set `JOB_EMBEDDING_MODEL` to an installed Ollama embedding model to rerank the shortlist with vector similarity. The twelve-chunk shortlist and bounded in-memory vector cache fit the existing single-profile query without a vector database. Embedding failures fall back to lexical retrieval.

The existing Ollama, Groq, and Gemini providers produce schema-validated score and confidence fields. Matching facts and explanations come from the deterministic evidence. Model influence is limited to −10 to +8 points and semantic influence to ±3 points. The rule ceiling still applies. Evaluation uses one configured model per job. Environment settings include `AI_PROVIDER`, the selected provider's model and key, `AI_TIMEOUT_MS`, `AI_MAX_CONCURRENT_REQUESTS`, `AI_DISCOVERY_AI_LIMIT`, and `OLLAMA_BASE_URL`. Set the batch AI limit to zero for rules-only imports. An explicit Analyze match request can still use the configured provider. Hosted contextual evaluation sends the posting and selected candidate excerpts to the provider.

## Cache and duplicate handling

MongoDB stores per-user evaluations under a fingerprint of the normalized scoring inputs, candidate profile, scoring version, prompt version, and model configuration. Changed inputs or old versions receive a fresh rule score on feed reads. Re-import and explicit analysis can refresh contextual evaluation. Failed import evaluations use a five-minute retry window. Vectors are cached in process memory by model, endpoint, and input content.

Exact duplicates share a board identity or a normalized posting URL. The service strips known tracking parameters and recognizes LinkedIn and Indeed posting variants. For probable matches across different boards, it requires matching normalized employer, equivalent title, matching location, at least 30 shared three-word sequences, and 92% Jaccard similarity. Posting dates must be within 14 days when both are known. Conflicting board IDs prevent a probable merge. Other close candidates are retained and flagged. A MongoDB unique index protects exact identities, and a per-company queue serializes probable comparisons within each backend instance. Existing records are collapsed at read time, preserving application history. No destructive database migration is required.

Feedback records are scoped to the authenticated account. A minimum of three explicit decisions about a company can move later jobs up or down by four ranking points. The original evidence score and account profile remain the basis for matching. Rejected, irrelevant, and duplicate-marked jobs are available in review.

## Verification and troubleshooting

Run `node --test test` from the backend. The fixtures cover policy categories, duplicates, repeated imports with mocked persistence, cache invalidation, retrieval, and invalid model outputs. Compare changes against these fixtures before adjusting thresholds. Check backend batch logs for duplicate counts, rejected payloads, the rule-score cutoff count, cached results, and model failures. Logs omit profile and job description content.

Board result cards may contain snippets. The scanner uses a visible LinkedIn or Indeed detail pane when it can verify the posting ID. Sparse text lowers evidence confidence and also makes cross-board deduplication less certain. Old rows keep their database IDs and application references. Two instances can still create a probable duplicate concurrently if the postings share no exact identity. Feed reads reconcile those records.

The model budget bounds per-batch calls, but the project has no live cost or production precision dashboard. Evaluate those metrics on representative imports before selecting an embedding model or increasing the budget.
