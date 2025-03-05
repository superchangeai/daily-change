const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { LiteralClient } = require('@literalai/client');
const { computeDiffs } = require('./services/diff-computation');
const { classifyChanges } = require('./services/classification');

// Only load dotenv if running locally
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Initialize LiteralClient with API key from environment
const literalClient = new LiteralClient({
  apiKey: process.env.LITERAL_API_KEY,
});

async function main() {
  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Initialize OpenAI client for Scaleway
  const scwApiKey = process.env.SCALEWAY_API_KEY;
  const openai = new OpenAI({
    apiKey: scwApiKey,
    baseURL: 'https://api.scaleway.ai/32c4ba40-7c02-4c97-886f-48d7c8a87755/v1',
  });

  literalClient.instrumentation.openai();

  console.log('Starting diff computation...');
  await computeDiffs(supabase, openai);

  console.log('Starting classification...');
  await classifyChanges(supabase, openai);

  console.log('Daily changes job completed');
}

main().catch((error) => {
  console.error('Error in change-job:', error.message);
  process.exit(1);
});