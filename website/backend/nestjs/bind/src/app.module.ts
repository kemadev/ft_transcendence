/* eslint-disable @typescript-eslint/no-unused-vars */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { DatabaseModule } from './database/database.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { AppGateway } from './app.gateway';
import { MatchModule } from './match/match.module';
import { MatchService } from './match/match.service';
import { MatchEntity } from './match/match.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
// import { SocketModule } from './socket/socket.module';

@Module({
	imports: [
		TypeOrmModule.forFeature([MatchEntity]),
		ConfigModule.forRoot({
			validationSchema: Joi.object({
				POSTGRES_HOST: Joi.string().required(),
				POSTGRES_PORT: Joi.number().required(),
				POSTGRES_USER: Joi.string().required(),
				POSTGRES_PASSWORD: Joi.string().required(),
				POSTGRES_DB: Joi.string().required(),
				PORT: Joi.number(),
				JWT_SECRET: Joi.string().required(),
				JWT_MAX_AGE: Joi.string().required(),
				API_42_UID: Joi.string().required(),
				API_42_SECRET: Joi.string().required(),
				API_42_REDIRECT_URI: Joi.string().required(),
			}),
		}),
		DatabaseModule,
		AuthenticationModule,
		UsersModule,
		ChatModule,
		// SocketModule
	],
	controllers: [],
	providers: [AppGateway, MatchModule, MatchService],
})
export class AppModule { }
