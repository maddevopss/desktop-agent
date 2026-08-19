const config = {
  AGENT_API_URL: process.env.AGENT_API_URL || "http://localhost:5000",
  AGENT_REFRESH_TIMEOUT_MS: Number(process.env.AGENT_REFRESH_TIMEOUT_MS || 15000),
};

module.exports = { config };
