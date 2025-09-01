# daily-changes

A lightweight Node.js service to review differences between consecutive content extractions and classify them using an LLM.

All content is sourced with [Daily-snapshot](https://github.com/superchangeai/daily-snapshot), a service dedicated to scraping, capturing relevant text content and storing it in simple JSON. 

## Execution

- CRON: This node script runs daily via **Github actions**, shortly after 7AM. See [Daily-changes.yml](https://github.com/superchangeai/daily-change/blob/main/.github/workflows/daily-changes.yml) for details.
- LLMs: This service currently relies on `Llama-3.3-70b-instruct` for diff and for subsequent classification. 
- Supabase: Postgres database where sources, snapshots and changes are fetched / stored.

## Setup

1. **Set `.env` variables:**

```
SUPABASE_URL=XX
SUPABASE_ANON_KEY=XX
```

2. **Install Dependencies:**
   ```bash
   npm install

3. **Run service:**

```bash
node change-job.js
```

## Database Schema

The project relies on two Supabase tables:

`dom_snapshots`

| Column | Type | Description | 
|--------|------|-------------|
| id     | int8     | Auto-incrementing ID (PK)          |
| url    | text     | Source URL (FK to sources)            |
| content    | text     | Parsed DOM content            |
| captured_at    | timestampz     | Time of snapshot            |

`changes`

| Column | Type | Description | Notes | 
|--------|------|-------------|-------------|
| id     | UUID     | Primary Key, NOT NULL, DEFAULT uuid_generate_v4()          | Unique identifier for each change record.|
| source_id     | UUID     | Foreign Key referencing sources.id, NOT NULL          | Links to the source (URL) that the change applies to.|
| snapshot_id1     | UUID     | Foreign Key referencing dom_snapshots.id, NOT NULL          | ID of the earlier snapshot for comparison.|
| snapshot_id2     | UUID     | Foreign Key referencing dom_snapshots.id, NOT NULL        | ID of the later snapshot for comparison.|
| diff     | JSONB     |  NOT NULL       | Stores the computed difference (e.g., JSON or text diff) between snapshot_id1 and snapshot_id2.|
| classification     | TEXT     | CHECK (classification IN ('breaking', 'security', 'performance', 'new_feature', 'minor_fix', 'other'))        | Category of the change, ensuring only predefined values.|
| explanation     | TEXT     |        | Brief explanation from the LLM about why the change was classified as such. Supports full-text search.|
| timestamp     | timestamp     | DEFAULT NOW()       | When the change was detected and recorded.|

## Explanation
- Diff Computation: The _diff_ field stores the structured output of an LLM asked to compare _snapshot_id1_ and _snapshot_id2_ from `dom_snapshots`. It is always set as a JSON object with one key "summary". 
- Classification: The _classification_ and _explanation_ fields are populated by the LLM-based classification service. 

