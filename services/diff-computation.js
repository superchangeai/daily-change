/**
 * Computes differences between consecutive snapshots using an LLM and stores them.
 * @param {Object} supabase - Supabase client instance
 * @param {Object} openai - OpenAI client instance
 * @param {string} differ - Model used for computing diff
 */
async function computeDiffs(supabase, openai, differ) {
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
    console.log('Processing snapshot', snapshotOld.id)
    console.log('vs...')
    console.log('snapshot', snapshotNew.id)
    let textOld = extractText(snapshotOld.content);
    let textNew = extractText(snapshotNew.content);

    // Get the latest change summary for this source, just in case
    const { data: latestChange, error: changeError } = await supabase
      .from('changes')
      .select('diff')
      .eq('source_id', source.id)
      .order('timestamp', { ascending: false })
      .limit(1);

    const latestSummary = latestChange?.[0]?.diff?.summary || '';

    // 1 token is roughly 4 characters, so we multiply context window by 4 to get the number of characters allowed in theory
    // my prompt is 3000 chars give or take, we need to save this space
    // two huge texts will get inserted in the prompt, we divide space by 3 just to avoid over stuffing the model
    const maxChars = Math.round((differ.context * 4 - 3000) / 3);
    // console.log('We re allowed up to', maxChars, 'chars per text')
    
    if (textOld.length > maxChars) {
      textOld = textOld.slice(0, maxChars);
      console.log('TextOld was too long, trimmed to', textOld.length, 'chars, which is roughly', Math.round(textOld.length/4), 'tokens')
    }
    if (textNew.length > maxChars) {
      textNew = textNew.slice(0, maxChars);
      console.log('TextNew was too long, trimmed to', textNew.length, 'chars, which is roughly', Math.round(textNew.length/4), 'tokens')
    }

    const diffJson = await getLLMChangeSummary(openai, differ.model, textOld, textNew, source.url, latestSummary);
    if (!diffJson || !diffJson.summary) {
      console.log(`Could not get a summary for ${source.url}, see further logs for troubleshoot.`);
      continue;
    }
    else if (diffJson.summary.toLowerCase().includes('no significant changes')) {
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
 * @param {string} latestSummary - Latest summary for this source if any
* @returns {Object|null} Parsed JSON object with "summary" key or null on error
 */
async function getLLMChangeSummary(openai, model, oldText, newText, url, latestSummary = '') {
  const systemPrompt = `
  You are a helpful assistant that strictly follows instructions. 
  Do not repeat yourself.
  Answer in 500 words or fewer. NEVER go above 2000 characters no matter what.
  `;
  const userPrompt = `
    <Task>
    Compare the following two texts from the documentation at ${url} and summarize the MEANINGFUL changes in a concise, human-readable format.
    If no significant changes are found, state "No significant changes detected." in the summary.
    If there are significant changes, summarize them according to the rules below.
    </Task>
    <Context>
    Think hard: what a technical audience can't miss about this update?
    In this context, significant changes can be many things: breaking changes, security updates, performance improvements, new options or features or models added, new dates for a migration or sunset, extended support, change of dates related to features or APIs, deprecations, removed field, renamed field, retired dates, end of life, end of support...  
    This documentation page is most likely a changelog, or release note, or API specs.
    ${latestSummary ? `\nHere's the previous change summary for context (do not repeat these changes):\n-------\n${latestSummary}\n-------\n` : ''}
    </Context>
    <Rules>
    Remember your latest change summary if any, making sure to add value to the audience before adding another change to the log.
    Ignore minor formatting or whitespace differences and focus on content updates, additions, or removals.
    Ignore the document "last updated date", irrelevant to the point.
    Ignore marketing events or other promotional content.
    No need to count items on the page. No need to count events or items on the page.
    If it's an API, prioritize new/removed endpoints in your summary.
    If a field is added or removed at once in multiple APIs, summarize the change as one. 
    If no significant changes are found, state "No significant changes detected." in the summary.
    </Rules>
    Be aware the two texts come from headless browser captures, and variations may arise from scraping or storage differences.
    <Format>
    Limit your summary to 500 words or fewer. NEVER go above 2000 characters no matter what. 
    Respond with a JSON object containing only the "summary" key with the change summary as a string. Do not include any additional JSON keys beyond "summary".
    </Format>
    Compare the following two texts now:
    ---------
    <Old text>
    ${oldText}
    </Old text>
    ---------
    <New text>
    ${newText}
    </New text>
  `.trim();

  try {
    console.log('Now sending request to LLM:', model);
    console.log('userPrompt length', userPrompt.length);
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

/**
 * TEST FUNCTION: Processes specific snapshots with verbose logging
 * @param {Object} supabase - Supabase client instance
 * @param {Object} openai - OpenAI client instance
 * @param {Object} differ - Model used for computing diff
 * @param {number} snapshotId1 - Older snapshot ID
 * @param {number} snapshotId2 - Newer snapshot ID
 */

async function testDiff(supabase, openai, differ, snapshotId1, snapshotId2) {
  console.log('\n=== STARTING TEST DIFF PROCESS ===');
  console.log(`Processing snapshots ${snapshotId1} vs ${snapshotId2}`);

  // Get both snapshots by ID
  console.log('\n1. Fetching specific snapshots...');
  const { data: snapshots, error: snapshotsError } = await supabase
    .from('dom_snapshots')
    .select('id, content, url')
    .in('id', [snapshotId1, snapshotId2]);

  if (snapshotsError || snapshots.length !== 2) {
    console.error('Error fetching snapshots:', snapshotsError?.message || 'Missing snapshots');
    return;
  }

  const [snapshotOld, snapshotNew] = snapshots.sort((a, b) => a.id - b.id);
  console.log(`2. Retrieved snapshots for URL: ${snapshotOld.url}`);
  console.log(`   Old snapshot ID: ${snapshotOld.id}, New snapshot ID: ${snapshotNew.id}`);

  // Extract text with verbose logging
  console.log('\n3. Extracting text content...');
  let textOld = extractText(snapshotOld.content);
  let textNew = extractText(snapshotNew.content);
  console.log(`   Old text length: ${textOld.length} chars, which is roughly ${Math.round(textOld.length/4)} tokens`);
  console.log(`   New text length: ${textNew.length} chars, which is roughly ${Math.round(textNew.length/4)} tokens`);

  // 1 token is roughly 4 characters, so we multiply context window by 4 to get the number of characters allowed in theory
  // my prompt is 3000 chars give or take, we need to save this space
  // two huge texts will get inserted in the prompt, we divide space by 3 just to avoid over stuffing the model

  const maxChars = Math.round((differ.context * 4 - 3000) / 3);
  console.log('We re allowed up to', maxChars, 'chars per text')

  if (textOld.length > maxChars) {
    textOld = textOld.slice(0, maxChars);
    console.log('TextOld was too long, trimmed to', textOld.length, 'chars, which is roughly', Math.round(textOld.length/4), 'tokens')
  }
  if (textNew.length > maxChars) {
    textNew = textNew.slice(0, maxChars);
    console.log('TextNew was too long, trimmed to', textNew.length, 'chars, which is roughly', Math.round(textNew.length/4), 'tokens')
  }
  
  // Get associated source
  console.log('\n4. Finding source for URL...');
  const { data: source, error: sourceError } = await supabase
    .from('sources')
    .select('id')
    .eq('url', snapshotOld.url)
    .eq('is_active', true)
    .single();

  if (sourceError || !source) {
    console.error('Source not found or inactive:', sourceError?.message || 'No active source');
    return;
  }
  console.log(`   Found source ID: ${source.id}`);

  // Get latest change summary
  console.log('\n5. Checking for previous summaries...');
  const { data: latestChange, error: changeError } = await supabase
    .from('changes')
    .select('diff')
    .eq('source_id', source.id)
    .order('timestamp', { ascending: false })
    .limit(1);

  const latestSummary = latestChange?.[0]?.diff?.summary || '';
  console.log(`   Previous summary exists: ${!!latestSummary}`);

  // Generate diff summary
  console.log('\n6. Generating LLM summary...');
  const diffJson = await getLLMChangeSummary(openai, differ.model, textOld, textNew, snapshotOld.url, latestSummary);
  
  if (!diffJson) {
    console.error('7. Aborting - LLM summary generation failed completely');
    return;
  }
  
  if (!diffJson.summary) {
    console.error('7. Aborting - LLM returned response but summary is missing');
    console.error('   Response received:', diffJson);
    return;
  }

  console.log(`   Summary generated (${diffJson.summary.length} chars):`, diffJson.summary.substring(0, 100) + '...');

  // Check existing diffs
  console.log('\n7. Checking for existing diff...');
  const exists = await diffExists(supabase, snapshotId1, snapshotId2);
  console.log(`   Diff already exists: ${exists}`);

  if (!exists) {
    console.log('\n8. Diff summary that would be stored:');
    console.log(JSON.stringify({
      source_id: source.id,
      snapshot_id1: snapshotId1,
      snapshot_id2: snapshotId2,
      diff: diffJson,
      timestamp: new Date().toISOString()
    }, null, 2));
  }

  console.log('\n=== TEST PROCESS COMPLETE ===\n');
}

module.exports = { computeDiffs, testDiff };