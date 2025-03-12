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
 * Computes differences between consecutive snapshots using an LLM and stores them.
 * @param {Object} supabase - Supabase client instance
 * @param {Object} openai - OpenAI client instance
 * @param {string} model - Model name used for computing diff
 */
async function computeDiffs(supabase, openai, model) {
  // Fetch all sources with is_active set to true
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, url')
    .eq('is_active', true);

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
    const textOld = extractText(snapshotOld.content);
    const textNew = extractText(snapshotNew.content);

    const diffJson = await getLLMChangeSummary(openai, model, textOld, textNew, source.url);
    if (!diffJson || !diffJson.summary || diffJson.summary.toLowerCase().includes('no significant changes')) {
      console.log(`No significant changes detected for ${source.url}`);
      continue;
    }

    // Check if diff already exists
    const exists = await diffExists(supabase, snapshotOld.id, snapshotNew.id);
    if (exists) {
      console.log(`Diff already exists for ${source.url} between snapshots ${snapshotOld.id} and ${snapshotNew.id}`);
      continue;
    }

    // Store the diff as a JSONB object
    const { error: insertError } = await supabase
      .from('changes')
      .insert({
        source_id: source.id,
        snapshot_id1: snapshotOld.id,
        snapshot_id2: snapshotNew.id,
        diff: diffJson, // Store the JSON object directly as JSONB
        timestamp: new Date().toISOString(),
      });

    if (insertError) {
      console.error(`Error storing diff for ${source.url}:`, insertError.message);
    } else {
      console.log(`Diff stored for ${source.url}`);
    }
  }
}

/**
 * Extracts text from snapshot content.
 * @param {string} content - Snapshot content (JSON or raw)
 * @returns {string} Extracted text
 */
function extractText(content) {
  try {
    const json = JSON.parse(content);
    return json.textContent || '';
  } catch (e) {
    console.log('Falling back to raw text:', e.message);
    return content; // Assume plain text if not JSON
  }
}

/**
 * Gets a human-readable change summary from the LLM as a JSON object with a single "summary" key.
 * @param {Object} openai - OpenAI client instance
 * @param {string} model - Model to consume through OpenAI sdk
 * @param {string} oldText - Older snapshot text
 * @param {string} newText - Newer snapshot text
 * @param {string} url - Source URL for context
 * @returns {Object|null} Parsed JSON object with "summary" key or null on error
 */
async function getLLMChangeSummary(openai, model, oldText, newText, url) {
  const systemPrompt = `
  You are a helpful assistant that strictly follows instructions. 
  Do not repeat yourself.
  Answer in 500 words or fewer. NEVER go above 2000 characters no matter what.
  `;
  const userPrompt = `
    Compare the following two texts from the documentation at ${url} and summarize the meaningful changes in a concise, human-readable format. 
    Limit the summary to 500 words or fewer. NEVER go above 2000 characters no matter what. 
    This page is most likely a changelog, or release note, or API specs.
    Ignore minor formatting or whitespace differences and focus on content updates, additions, or removals.
    If it's an API, prioritize new/removed endpoints in your summary.
    If a field is added or remove at once in multiple APIs, summarize the change as one. 
    In this context, significant changes can be many things: breaking changes, security updates, performance improvements, new options or features or models added, new dates, extended support, change of dates, deprecations, removed field, renamed field, retired dates, end of life, end of support... 
    If no significant changes are found, state "No significant changes detected." in the summary.
    Be aware the two texts come from headless browser captures, and variations may arise from scraping or storage differences.
    Respond with a JSON object containing only the "summary" key with the change summary as a string. Do not include any additional JSON keys beyond "summary".

    Old text:
    ${oldText}
    ---------
    New text:
    ${newText}
  `.trim();

  try {
    const response = await openai.chat.completions.create({
      model: model, // defined in change-job.js
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ChangeSummary",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" }
            },
            additionalProperties: false,
            required: ["summary"]
          }
        }
      }
    });

    const jsonString = response.choices[0].message.content;
    const finishReason = response.choices[0].finish_reason;
    console.log('Finish reason:', finishReason);
    
    // Handle truncated JSON when finish_reason is "length"
    if (finishReason === 'length') {
      console.log('Response was truncated due to length. Creating clean summary object...');
      // Extract any text content we can from the truncated response
      let extractedText = "";
      try {
        // Try to extract text between quotes after "summary":
        const summaryMatch = jsonString.match(/"summary"\s*:\s*"([^"]+)/);
        if (summaryMatch && summaryMatch[1]) {
          extractedText = summaryMatch[1].trim();
          // Limit to a reasonable length and add ellipsis
          if (extractedText.length > 40000) {
            extractedText = extractedText.substring(0, 40000) + "...";
          }
        }
      } catch (e) {
        // If extraction fails, use default message
      }
      
      // Create a clean object with the extracted text or default message
      return {
        summary: extractedText || "Content changes detected, but the summary was too long to process completely."
      };
    } else {
      // Normal parsing for complete responses
      try {
        return JSON.parse(jsonString);
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError.message);
        return { summary: "Error parsing change summary response." };
      }
    }
  } catch (error) {
    console.error('Error getting LLM summary:', error.message);
    return null; // Return null on error to skip processing
  }
}

module.exports = { computeDiffs };