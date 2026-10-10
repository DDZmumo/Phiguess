import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app';
import { configuration } from './config';

async function main() {
  const app=await NestFactory.create(AppModule,{bodyParser:false});
  configureApp(app);
  await app.listen(configuration().PORT,'0.0.0.0');
}
void main().catch(error=>{ console.error(error); process.exitCode=1; });
