export type StagingConfig = { botToken: string; groupId: number; dataDir: string };

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Staging gateway requires ${name}`);
  return value;
}

export function assertStagingEnvironment(env: NodeJS.ProcessEnv = process.env): StagingConfig {
  if (env.DEPLOY_ENV !== 'staging') throw new Error('Staging gateway requires DEPLOY_ENV=staging');
  const botToken = env.TG_TOKEN?.trim() ?? '';
  const groupId = Number(env.TG_GROUP_ID);
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) throw new Error('Staging gateway requires a staging-format TG_TOKEN');
  if (!Number.isSafeInteger(groupId) || groupId >= 0) throw new Error('Staging gateway requires a negative TG_GROUP_ID');
  const dataDir = required('DATA_DIR', env);
  if (env.PRODUCTION === '1' || env.NODE_ENV === 'production') throw new Error('Staging gateway refuses production environment');
  return { botToken, groupId, dataDir };
}

export function createStagingGateway(env: NodeJS.ProcessEnv = process.env): StagingConfig {
  return assertStagingEnvironment(env);
}

export default createStagingGateway;

if (process.env.DEPLOY_ENV === 'staging' && process.env.STAGING_GATEWAY_STARTUP_CHECK === '1') assertStagingEnvironment();

// ponytail: guard validates identity and storage isolation only; add endpoint allowlists before live staging traffic.
