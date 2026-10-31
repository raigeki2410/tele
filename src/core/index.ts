export * from './contracts.js';
export * from './persistence.js';
export * from './router.js';
export * from './db.js';
export * from './sqlitePersistence.js';
export * from './queue.js';
export * from './adapters/zaloShadow.js';
export * from './adapters/tammiShadow.js';
export * from './stagingGateway.js';

// ponytail: staging gateway is opt-in; wire it into an isolated live entrypoint when credentials exist.
