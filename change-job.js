const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { computeDiffs } = require('./services/diff-computation');
const { classifyChanges } = require('./services/classification');
const { createRateLimitedClient } = require('./services/rate-limiter');

// Only load dotenv if running locally
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

async function main() {
  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // several OpenAI-compatible providers
  const providers = {
    scaleway: {
      apiKey: process.env.SCALEWAY_API_KEY,
      baseURL: 'https://api.scaleway.ai/v1',
      differ: {model:'llama-3.3-70b-instruct',context: 131000},
      classifier: {model:'llama-3.3-70b-instruct',context: 131000},
    },
    gemini: {
      apiKey: process.env.GOOGLE_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      differ: {model:'gemini-2.0-flash',context: 1000000},
      classifier: {model:'gemini-2.0-flash-lite',context: 1000000},
    },
    together: {
      apiKey: process.env.TOGETHER_API_KEY,
      baseURL: 'https://api.together.xyz/v1/',
      differ: {model:'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',context: 131000},
      classifier: {model:'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',context: 131000},
    }
  };

  // Initialize OpenAI client with one provider
  const currentProvider = 'scaleway';

  const openai = new OpenAI({
    apiKey: providers[currentProvider].apiKey,
    baseURL: providers[currentProvider].baseURL
  });

  const differ = providers[currentProvider].differ; // this model will analyze the difference between two large strings and output a summary in JSON format. Large context matters.
  const classifier = providers[currentProvider].classifier; // this model will review the diff, tag it and explain its classification, all in JSON schema. Smaller models can do.

  // Create rate-limited client
  const rateLimitedOpenAI = createRateLimitedClient(openai);

  console.log('----- 1. Starting diff computation...');
  await computeDiffs(supabase, rateLimitedOpenAI, differ);

  console.log('----- 2. Starting classification...');
  await classifyChanges(supabase, rateLimitedOpenAI, classifier);

  console.log('Daily changes job completed');
}

main().catch((error) => {
  console.error('Error in change-job:', error.message);
  process.exit(1);
});
