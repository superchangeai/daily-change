/**
 * Classifies unclassified changes using an LLM.
 * @param {Object} supabase - Supabase client instance
 * @param {Object} openai - OpenAI client instance
 * @param {string} model - Model name used for classifyng changes
 */
async function classifyChanges(supabase, openai, model) {
  // Fetch unclassified changes with their source URLs
  const { data: changes, error: changesError } = await supabase
    .from('changes')
    .select('id, diff, source_id')
    .is('classification', null);

  if (changesError) {
    console.error('Error fetching changes:', changesError.message);
    return;
  }

  if (!changes.length) {
    console.log('No unclassified changes to process');
    return;
  }

  // Fetch URLs for all source_ids
  const sourceIds = [...new Set(changes.map((c) => c.source_id))];
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, url')
    .in('id', sourceIds);

  if (sourcesError) {
    console.error('Error fetching source URLs:', sourcesError.message);
    return;
  }

  const sourceMap = new Map(sources.map((s) => [s.id, s.url]));

  for (const change of changes) {
    const url = sourceMap.get(change.source_id);

    // Ensure diff is a valid JSON object with a summary
    if (!change.diff || !change.diff.summary) {
      console.error(`Change ${change.id} has invalid diff format; expected a JSON object with a 'summary' field`);
      continue;
    }
    const diffSummary = change.diff.summary; // Extract summary from JSON object

    console.log(`Change ${change.id} diff type:`, typeof change.diff);
    console.log(`Change ${change.id} diff content:`, change.diff);

    const prompt = `
      Below is a change summary for the documentation at ${url}:

      Change:
      ${diffSummary}

      Classify the change into one of the following categories: breaking change, security update, performance improvement, new feature, minor bug fix, or other. Provide a brief explanation for your classification.
      Respond with a JSON object containing exactly two fields: "classification" and "explanation".
      The "classification" field must be one of: ["breaking", "security", "performance", "new_feature", "minor_fix", "other"].
      The "explanation" field must be a concise string justifying the classification.
    `.trim();

    console.log(`Processing change ${change.id} for ${url}: ${diffSummary}`);

    try {
      const response = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that strictly follows instructions and provides structured JSON responses.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ChangeClassification",
            schema: {
              type: "object",
              properties: {
                classification: {
                  type: "string",
                  enum: ["breaking", "security", "performance", "new_feature", "minor_fix", "other"]
                },
                explanation: { type: "string" }
              },
              additionalProperties: false,
              required: ["classification", "explanation"]
            }
          }
        }
      });

      const result = JSON.parse(response.choices[0].message.content);
      const { classification, explanation } = result;

      // Validate the response to ensure no undefined values
      if (!classification || !explanation) {
        console.error(`Invalid LLM response for change ${change.id}:`, result);
        continue;
      }

      console.log(`Classification for change ${change.id}: ${classification}`);
      console.log(`Explanation: ${explanation}`);

      const { error: updateError } = await supabase
        .from('changes')
        .update({ classification, explanation })
        .eq('id', change.id);

      if (updateError) {
        console.error(`Error updating change ${change.id}:`, updateError.message);
      } else {
        console.log(`Classified change ${change.id} as ${classification}`);
      }
    } catch (error) {
      console.error(`Error classifying change ${change.id}:`, error.message);
    }
  }
}

module.exports = { classifyChanges };