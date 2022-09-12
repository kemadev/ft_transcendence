import {
	Body,
	Req,
	Res,
	Controller,
	HttpCode,
	Post,
	Get,
	UseGuards,
	Param,
	Logger,
} from '@nestjs/common';
import { get } from 'http';
import ProfileUserDto from 'src/users/dto/ProfileUserDto';
import ResumUserDto from 'src/users/dto/ResumUserDto';
import BasicUserDto from '../chat/dto/BasicUserDto';
import UserDto from './dto/user.dto';

import { UsersService } from './users.service';

@Controller('user')
export class UsersController {
	private logger: Logger = new Logger('UsersController');
	constructor(private readonly usersService: UsersService) { }

	@Get('getBasicUser/:login')
	async getBasicUser(@Param() params : {login: string}) {
		let user = await this.usersService.getByLogin(params.login);
		return new BasicUserDto(user.login);
  }

	// @UseGuards(JwtAuthenticationGuard) FIXME
	@Post('getUser')
	async getUser(@Body() params: any) {
		console.log('getUser: starting for ' + params.login);
		let test = new ProfileUserDto(await this.usersService.getByLogin(params.login))
		this.logger.log('getUser: ' + test.login);
		return test;
	}
	@Post('getUsers')
	async getUsers(@Body() str: string) {
		this.logger.log('getUsers: starting for ' + str.toString());
		return this.usersService.getByLoginFiltred(str);
	}
	// @Post('getAnyByLogin')
	// async getAnyByLogin(@Body() params: any) {
	// 	return this.usersService.getAnyByLogin(params.login, params.infos);
	// }
}
