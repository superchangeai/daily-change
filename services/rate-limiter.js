/**
 * Rate limiting service for API clients
 */

// Rate limiting configuration for different models
const RATE_LIMITS = {
  'gemini-2.0-flash': 15, // 15 RPM
  'gemini-2.0-flash-lite': 30, // 30 RPM
  // Add other models as needed
};

// Rate limiting state
const rateLimitState = {
  lastRequestTime: {},
};

/**
 * Creates a rate-limited OpenAI client wrapper
 * @param {Object} openai - Original OpenAI client
 * @param {Object} rateLimits - Map of model names to their RPM limits (optional)
 * @returns {Object} Rate-limited OpenAI client
 */
function createRateLimitedClient(openai, rateLimits = RATE_LIMITS) {
  // Create a proxy to intercept API calls
  const rateLimitedClient = {
    ...openai,
    chat: {
      ...openai.chat,
      completions: {
        create: async (params) => {
          const model = params.model;
          const rpm = rateLimits[model] || 15; // Default to 15 RPM if model not found
          
          // Calculate minimum delay between requests
          const minDelayMs = 60000 / rpm;
          
          // Initialize last request time for this model if not exists
          if (!rateLimitState.lastRequestTime[model]) {
            rateLimitState.lastRequestTime[model] = 0;
          }
          
          // Apply rate limiting
          const now = Date.now();
          const timeElapsed = now - rateLimitState.lastRequestTime[model];
          
          if (timeElapsed < minDelayMs) {
            const delayNeeded = minDelayMs - timeElapsed;
            console.log(`Rate limiting for ${model}: waiting ${delayNeeded}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, delayNeeded));
          }
          
          // Update last request time
          rateLimitState.lastRequestTime[model] = Date.now();
          
          // Make the actual API call
          return openai.chat.completions.create(params);
        }
      }
    }
  };
  
  return rateLimitedClient;
}

module.exports = {
  createRateLimitedClient,
  RATE_LIMITS
};