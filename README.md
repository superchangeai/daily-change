# daily-changes

A lightweight Node.js service that computes differences between consecutive DOM snapshots and classifies them using an LLM, running daily via GitHub Actions.

## Setup

1. **Install Dependencies:**
   ```bash
   npm install

## Database Schema

The project uses two Supabase tables:

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
- Diff Computation: The _diff_ field stores the result of comparing _snapshot_id1_ and _snapshot_id2_ from `dom_snapshots`.
- Classification: The _classification_ and _explanation_ fields are populated by the LLM-based classification service.
- Querying: 
    - Retrieve breaking changes: 
    ```sql
    SELECT * FROM changes WHERE classification = 'breaking' ORDER BY timestamp DESC;
    ```
    - Search explanations:
    ```sql 
    SELECT * FROM changes WHERE to_tsvector('english', explanation) @@ to_tsquery('english', 'security');
    ```
