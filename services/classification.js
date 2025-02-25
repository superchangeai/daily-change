const OpenAI = require('openai');

/**
 * Classifies unclassified changes using an LLM.
 * @param {Object} supabase - Supabase client instance
 * @param {Object} openai - OpenAI client instance
 */
async function classifyChanges(supabase, openai) {
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
  const sourceIds = [...new Set(changes.map(c => c.source_id))];
  const { data: sources, error: sourcesError } = await supabase
    .from('sources')
    .select('id, url')
    .in('id', sourceIds);

  if (sourcesError) {
    console.error('Error fetching source URLs:', sourcesError.message);
    return;
  }

  const sourceMap = new Map(sources.map(s => [s.id, s.url]));

  for (const change of changes) {
    const url = sourceMap.get(change.source_id);
    const diffString = diffToString(change.diff);

    const prompt = `
Here is a change in the documentation for ${url}:

${diffString}

Classify this change into one of: breaking change, security update, performance improvement, new feature, minor bug fix, or other. Provide a brief explanation.
Respond in JSON format with two fields: "classification" and "explanation".
Classification must be strictly one of the following propositions: ['breaking'::text, 'security'::text, 'performance'::text, 'new_feature'::text, 'minor_fix'::text, 'other'::text]

    `.trim();

    try {
      const response = await openai.chat.completions.create({
        model: 'gemini-2.0-flash-exp',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content);
      const classification = result.classification;
      const explanation = result.explanation;
      console.log("Classification:" + classification);
      console.log("Explanation:" + explanation);

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

/**
 * Converts a diff array to a human-readable string.
 * @param {Array} diff - Diff array from the diff library
 * @returns {string} Formatted diff string
 */
function diffToString(diff) {
  return diff
    .map(part => {
      if (part.added) return `+ ${part.value}`;
      if (part.removed) return `- ${part.value}`;
      return `  ${part.value}`;
    })
    .join('');
}

module.exports = { classifyChanges };