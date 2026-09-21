import express from 'express';
import { resolve } from 'node:path';
import { createApi } from './api.mjs';
import { productionStore } from './store.mjs';

const origin = process.env.APP_ORIGIN;
if (!origin?.startsWith('https://')) throw new Error('Set APP_ORIGIN to the public HTTPS origin.');
const app = createApi({ store: productionStore(), sessionSecret: process.env.AUTH_SESSION_SECRET, secureCookies: true, allowedOrigin: origin });
app.use(express.static(resolve('dist'), { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
app.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('SpiceSentry server started.'));
