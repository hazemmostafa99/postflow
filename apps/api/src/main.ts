import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import morgan from 'morgan';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.use(morgan(':method :url :status :response-time ms'));
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  console.info('[PostFlow] TikTok extension publishing', {
    enabled: process.env.TIKTOK_EXTENSION_PUBLISHING_ENABLED === 'true',
  });
  await app.listen(process.env.PORT ?? 8000);
}
void bootstrap();
