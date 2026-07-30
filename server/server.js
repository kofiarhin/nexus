import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = createApp();

app.listen(env.port, () => {
  console.log(`Nexus API listening on port ${env.port}`);
});
