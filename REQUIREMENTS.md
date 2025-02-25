## Step 1: Computing Differences

### Approach
Given that our [Daily-snapshot](https://github.com/tgenaitay/daily-snapshot) service captures DOM snapshots and stores either extracted JSON or full HTML, computing differences between consecutive snapshots must handle both formats effectively.

### Strategy

1. Primary Case: Extracted Content (JSON):
- When Readability succeeds, the snapshot content is a JSON string (e.g., { title, byline, content }).
- Compute diffs on the content field (or other relevant fields) to focus on meaningful changes.
- Use a library like deep-diff for structured JSON diffs or diff (e.g., jsdiff) for text-based diffs on the content field.

2. Fallback Case: Full HTML:
- When Readability fails, the snapshot contains raw HTML.
- Compute diffs on the full HTML using a library like html-differ.
- Optionally, normalize HTML (e.g., remove dynamic attributes like data-timestamp or minify) to reduce noise.

### Implementation Details

1. Fetch Consecutive Snapshots:
- Query Supabase for the two most recent snapshots for a URL:
```sql
SELECT id, content, captured_at
FROM dom_snapshots
WHERE url = :url
ORDER BY captured_at DESC
LIMIT 2
```
2. Determine Content Type:
- Attempt to parse content as JSON. If successful, it’s Readability-extracted data; otherwise, treat it as HTML.
3. Compute Diff:
- JSON case: Parse both snapshots’ content fields and diff with deep-diff or diff.
- HTML case: Use html-differ to compute differences, optionally preprocessing to filter out noise.
- Detect if there is no diff, do not store if no changes happened.
4. Store Diff:
- If any, save the diff in the `changes` table with references to the snapshot IDs:
```sql
INSERT INTO changes (source_id, snapshot_id1, snapshot_id2, diff, timestamp)
VALUES (:source_id, :prev_id, :latest_id, :diff_json, NOW())
```
#### Why This Works

- Focus on Meaningful Changes: Using extracted content reduces noise from layout or styling changes.
- Flexibility: Fallback to HTML diffs ensures coverage for all pages, even those not suited to Readability.
- Efficiency: Store only diff when changes occurred.

## Step 2: Classifying Changes

### Approach
With diffs computed, classify them into categories (e.g., breaking change, security update, new feature) using an LLM for semantic understanding.

### Strategy
- Input: Use the diff from Step 1 as the primary input, supplemented with context (e.g., URL, timestamps). Only happens when a diff was found and stored, so that we do not make LLM calls for no reasons.
- LLM Classification:
    - Prompt the LLM with the diff and a classification task:

```
Here is a change in the documentation for [URL]:
[insert diff]
Classify this change into one of: breaking change, security update, performance improvement, new feature, minor bug fix, or other. Provide a brief explanation.
```
-  Optimization:
    - Filter Trivial Changes: Skip diffs with minimal impact (e.g., small text changes, formatting) using heuristics (e.g., diff size < 10 characters).
    - Batch Processing: Group multiple diffs into a single LLM call to reduce API costs.

### Implementation Details

1. Fetch Unclassified Diffs:
    - Query Supabase:
    ``` sql
    SELECT id, diff, source_id
    FROM changes
    WHERE classification IS NULL
    ```
2. Classify with LLM:
    - Use an LLM API to process the prompt.
        - Focus on `gemini-2.0-flash-exp` since it's free to consume with up to 1500 requests per day, (15 requests per minute and 1M tokens per minute max)
        - Use only OpenAI-compatible endpoints, so that we can move to another model whenever. See https://ai.google.dev/gemini-api/docs/openai#node.js for Google
    - Parse the response for category and explanation.
3. Store Results:
    - Update the `changes` table:
    ```sql
    UPDATE changes
    SET classification = :category, explanation = :explanation
    WHERE id = :id
    ```

### Why This Works
- Semantic Accuracy: LLMs excel at understanding context, making them ideal for nuanced classification.
- Efficiency: Filtering and batching reduce costs while maintaining quality.

### Architecture Overview

1. Components
- Diff Computation Service: Runs daily, computes diffs between consecutive snapshots, and stores in change_logs.
- Classification Service: Processes diffs with an LLM, classifies changes, and updates change_logs.
2. Supabase Database:
- Tables:
    - `sources`: Tracks URLs and last_snapshot_at.
    - `dom_snapshots`: Stores snapshots (URL, content, captured_at).
    - `changes`: Stores diffs and classifications (source_id, snapshot IDs, diff, classification, explanation).

3. Workflow
- Snapshot Capture: Triggered daily (via GitHub Actions), capturing snapshots for all URLs in sources. See: https://github.com/tgenaitay/daily-snapshot
- Diff Computation: A daily job processes new snapshots, computes diffs, and stores them.
- Classification: A subsequent job classifies diffs and updates the database.

4. Scalability and Efficiency
- Incremental Processing: Only process URLs with new snapshots (check last_snapshot_at).
- Parallelization: Use Node.js worker threads or serverless functions to handle multiple URLs concurrently.
- Cost Management: Filter trivial diffs and batch LLM calls.