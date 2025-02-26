const { createClient } = require('@supabase/supabase-js');
const Diff = require('diff');
const { htmlToText } = require('html-to-text');

/**
 * Checks if a diff already exists for the given snapshot pair.
 * @param {Object} supabase - Supabase client instance
 * @param {number} snapshotId1 - Older snapshot ID
 * @param {number} snapshotId2 - Newer snapshot ID
 * @returns {boolean} True if diff exists
 */
async function diffExists(supabase, snapshotId1, snapshotId2) {
  const { data, error } = await supabase
    .from('changes')
    .select('id')
    .eq('snapshot_id1', snapshotId1)
    .eq('snapshot_id2', snapshotId2)
    .limit(1);

  if (error) {
    console.error('Error checking existing diff:', error.message);
    return false; // Default to false on error to proceed with insertion
  }

  return data.length > 0;
}

/**
 * Computes differences between consecutive snapshots and stores them.
 * @param {Object} supabase - Supabase client instance
 */
async function computeDiffs(supabase) {
  // Fetch all sources
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, url');

  if (sourcesError) {
    console.error('Error fetching sources:', sourcesError.message);
    return;
  }

  for (const source of sources) {
    // Get the two most recent snapshots for the source URL
    const { data: snapshots, error: snapshotsError } = await supabase
      .from('dom_snapshots')
      .select('id, content')
      .eq('url', source.url)
      .order('captured_at', { ascending: false })
      .limit(2);

    if (snapshotsError) {
      console.error(`Error fetching snapshots for ${source.url}:`, snapshotsError.message);
      continue;
    }

    if (snapshots.length < 2) {
      console.log(`Skipping ${source.url}: fewer than 2 snapshots`);
      continue;
    }

    const [snapshotNew, snapshotOld] = snapshots;
    const diff = computeTextDiff(snapshotOld.content, snapshotNew.content);

    if (isDiffEmpty(diff)) {
      console.log(`No changes detected for ${source.url}`);
      continue;
    }

    // Check if diff already exists
    const exists = await diffExists(supabase, snapshotOld.id, snapshotNew.id);
    if (exists) {
      console.log(`Diff already exists for ${source.url} between snapshots ${snapshotOld.id} and ${snapshotNew.id}`);
      continue;
    }

    // Store the diff in the changes table
    const { error: insertError } = await supabase
      .from('changes')
      .insert({
        source_id: source.id,
        snapshot_id1: snapshotOld.id,
        snapshot_id2: snapshotNew.id,
        diff: diff,
        timestamp: new Date().toISOString()
      });

    if (insertError) {
      console.error(`Error storing diff for ${source.url}:`, insertError.message);
    } else {
      console.log(`Diff stored for ${source.url}`);
    }
  }
}

/**
 * Computes a text-based diff between two content strings.
 * @param {string} content1 - Older snapshot content
 * @param {string} content2 - Newer snapshot content
 * @returns {Array} Diff array from the diff library
 */
function computeTextDiff(content1, content2) {
  let text1, text2;

  // Try parsing as JSON; if it fails, assume HTML
  try {
    const json1 = JSON.parse(content1);
    text1 = json1.content || '';
  } catch {
    text1 = htmlToText(content1, { wordwrap: false });
  }

  try {
    const json2 = JSON.parse(content2);
    text2 = json2.content || '';
  } catch {
    text2 = htmlToText(content2, { wordwrap: false });
  }

  return Diff.diffWords(text1, text2);
}

/**
 * Checks if a diff contains no meaningful changes.
 * @param {Array} diff - Diff array from the diff library
 * @returns {boolean} True if no additions or removals
 */
function isDiffEmpty(diff) {
  return diff.every(part => !part.added && !part.removed);
}

module.exports = { computeDiffs };