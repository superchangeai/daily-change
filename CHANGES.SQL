-- Enable UUID extension (already enabled in Supabase by default)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the changes table
CREATE TABLE changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  snapshot_id1 UUID NOT NULL REFERENCES dom_snapshots(id) ON DELETE CASCADE,
  snapshot_id2 UUID NOT NULL REFERENCES dom_snapshots(id) ON DELETE CASCADE,
  diff JSONB NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('breaking', 'security', 'performance', 'new_feature', 'minor_fix', 'other')),
  explanation TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_changes_source_id ON changes(source_id);
CREATE INDEX idx_changes_snapshot_id1 ON changes(snapshot_id1);
CREATE INDEX idx_changes_snapshot_id2 ON changes(snapshot_id2);
CREATE INDEX idx_changes_classification ON changes(classification);
CREATE INDEX idx_changes_timestamp ON changes(timestamp);
CREATE INDEX idx_changes_explanation_search ON changes USING GIN(to_tsvector('english', explanation));