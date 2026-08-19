const logger = require("../utils/logger");

const metrics = {
  counters: {},

  inc(name, value = 1, tags = {}) {
    if (!this.counters[name]) this.counters[name] = 0;
    this.counters[name] += value;

    // Log structuré pour l'ingestion par un collecteur de logs
    logger.info(`METRIC_INC`, {
      metric: name,
      value,
      ...tags,
      timestamp: new Date().toISOString(),
    });
  },

  getSnapshot() {
    return { ...this.counters };
  },
};

module.exports = metrics;
