import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

async function bootstrap() {
  loadConfig();

  const adapter = new FastifyAdapter({ logger: true });

  // Adds request.rawBody (needed for GitHub webhook signature verification).
  // Scope to only webhook route to avoid extra memory for other routes.
  const rawBodyPlugin = (await import('fastify-raw-body')).default;
  await adapter.getInstance().register(rawBodyPlugin, {
    field: 'rawBody',
    routes: ['/webhooks/github'],
    encoding: 'utf8',
    runFirst: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

bootstrap();
