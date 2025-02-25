const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { computeDiffs } = require('./services/diff-computation');
const { classifyChanges } = require('./services/classification');

// Only load dotenv if running locally
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

async function main() {
  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Initialize OpenAI client for Google Gemini
  const googleApiKey = process.env.GOOGLE_API_KEY;
  const openai = new OpenAI({
    apiKey: googleApiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' // Adjust based on actual API endpoint
  });

  console.log('Starting diff computation...');
  await computeDiffs(supabase);

  console.log('Starting classification...');
  await classifyChanges(supabase, openai);

  console.log('Daily changes job completed');
}

main().catch(error => {
  console.error('Error in change-job:', error.message);
  process.exit(1);
});