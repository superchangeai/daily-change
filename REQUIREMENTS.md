## Dependency

Our [Daily-snapshot](https://github.com/tgenaitay/daily-snapshot) service captures website content, which is stored as JSON. 

## Step 1: Computing Differences

### Approach
We will use LLMs to compute meaningful differences between consecutive snapshots.

### Strategy
1. Primary Case: Extracted Content (JSON):
- When Readability succeeds, the snapshot content is a JSON string
- Use LLM to compare and summarize meaningful changes in content

2. Fallback Case: Full HTML:
- When Readability fails, the snapshot contains raw HTML
- Use LLM to compare and summarize meaningful changes in HTML content

### Implementation Details
1. Fetch Consecutive Snapshots:
```sql
SELECT id, content, captured_at
FROM dom_snapshots
WHERE url = :url
ORDER BY captured_at DESC
LIMIT 2
```
2. Extract Text Content:
- Parse JSON content or use raw HTML as fallback
3. Compute Diff with LLM:
- Pass text content to LLM for comparison and summarization
- Store summary as JSON with format: { summary: "..." }
4. Store Diff:
```sql
INSERT INTO changes (source_id, snapshot_id1, snapshot_id2, diff, timestamp)
VALUES (:source_id, :prev_id, :latest_id, :diff_json, NOW())
```

## Step 2: Classifying Changes

### Approach
With LLM-computed diffs, we classify them into categories using another LLM call for semantic understanding.

### Strategy
- Input: LLM-generated diff summary
- Use LLM to classify changes into predefined categories
- Optimize by filtering trivial changes and batching requests

### Implementation Details
1. Fetch Unclassified Diffs:
```sql
SELECT id, diff, source_id
FROM changes
WHERE classification IS NULL
```
2. Classify with LLM:
- Use LLM API to process classification prompt
- Parse response for category and explanation
3. Store Results:
```sql
UPDATE changes
SET classification = :category, explanation = :explanation
WHERE id = :id
```

### Architecture Overview
1. Components
- Diff Computation Service: Uses LLM to compute diffs
- Classification Service: Uses LLM to classify changes
2. Supabase Database:
- `sources`: Tracks URLs
- `dom_snapshots`: Stores snapshots
- `changes`: Stores diffs and classifications

3. Workflow
- Snapshot Capture: Daily via GitHub Actions
- Diff Computation: Daily job using LLM
- Classification: Subsequent job using LLM

4. Scalability and Efficiency
- Incremental Processing: Only process URLs with new snapshots
- Parallelization: Handle multiple URLs concurrently
- Cost Management: Filter trivial diffs and batch LLM calls