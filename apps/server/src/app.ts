import { Module, type INestApplication } from '@nestjs/common';
import { json } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { AuthGuard, AuthService } from './auth';
import { CatalogService } from './catalog';
import { configuration } from './config';
import { Db } from './db';
import { Events } from './events';
import { GamesService } from './games';
import { GameController, PublicController } from './http';
import { RealtimeGateway } from './realtime';
import { RoomsService } from './rooms';
import { MediaService } from './media';

@Module({ controllers:[PublicController,GameController], providers:[Db,AuthService,AuthGuard,CatalogService,Events,GamesService,RoomsService,RealtimeGateway,MediaService] })
export class AppModule {}
export function configureApp(app: INestApplication) {
  const config=configuration();
  app.getHttpAdapter().getInstance().set('trust proxy',config.TRUST_PROXY==='1' ? 1 : false);
  app.use(helmet()); app.use(json({limit:'16kb'}));
  app.enableCors({origin:config.PUBLIC_ORIGIN,methods:['GET','POST'],allowedHeaders:['Authorization','Content-Type']});
  app.use('/api',rateLimit({windowMs:60_000,limit:240,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use('/api/auth/guest',rateLimit({windowMs:3600_000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use('/api/auth/login',rateLimit({windowMs:15*60_000,limit:20,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use('/api/me/avatar',rateLimit({windowMs:60_000,limit:6,standardHeaders:'draft-8',legacyHeaders:false}));
  app.enableShutdownHooks();
}
