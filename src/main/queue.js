function createQueueModule() {
  return {
    flush: async () => ({ flushed: 0 }),
    push: () => true,
  };
}

module.exports = createQueueModule();
