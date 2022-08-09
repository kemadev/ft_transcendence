import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import RegisterDto from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { PostgresErrorCode } from '../database/postgresErrorCodes.enum';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AuthResponse } from './authResponse.interface';
import * as crypto from 'crypto';
import TotpDto from './dto/totp.dto';
import axios from 'axios';
import CreateUserDto from '../users/dto/createUser.dto';

// NOTE - API's documentation can be found at `docs/api/v1.md`

@Injectable()
export class AuthenticationService {
	constructor(
		private readonly usersService: UsersService,
		private readonly configService: ConfigService,
		private readonly jwtService: JwtService,
		private httpService: HttpService,
	) {}

	public async register(registrationData: RegisterDto) {
		console.log('register: starting for login: ' + registrationData.login);
		if (registrationData.password !== registrationData.password_confirmation) {
			console.error('register: ' + 'passwords do not match, returning ✘');
			throw new HttpException('E_PASS_DIFFERS', HttpStatus.BAD_REQUEST);
		}
		if (
			registrationData.password.length > 32 ||
			!registrationData.password.match(
				/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])(?=^[a-zA-Z0-9!@#$%^&*]*$).{10,32}$/,
			)
		) {
			console.error(
				'register: ' + 'password does not meet requirements, returning ✘',
			);
			throw new HttpException(
				'E_PASS_NOT_MEET_REQUIREMENTS',
				HttpStatus.BAD_REQUEST,
			);
		}
		if (
			registrationData.email.length > 50 ||
			!registrationData.email.match(
				/^[a-zA-Z0-9-]+(?:[\.+-][a-zA-Z0-9]+){0,}@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]{1,}){1,}$/,
			)
		) {
			console.error(
				'register: ' + 'email does not meet requirements, returning ✘',
			);
			throw new HttpException(
				'E_MAIL_NOT_MEET_REQUIREMENTS',
				HttpStatus.BAD_REQUEST,
			);
		}
		if (
			registrationData.login.length > 25 ||
			!registrationData.login.match(/^[a-zA-z0-9-_ ]{1,25}$/)
		) {
			console.error(
				'register: ' + 'login does not meet requirements, returning ✘',
			);
			throw new HttpException(
				'E_LOGIN_NOT_MEET_REQUIREMENTS',
				HttpStatus.BAD_REQUEST,
			);
		}
		let hashedPassword = '';
		try {
			hashedPassword = await bcrypt.hash(registrationData.password, 10);
		} catch (error) {
			console.error('register: ' + 'bcrypt error, returning ✘');
			throw new HttpException(
				'E_UNEXPECTED_ERROR',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
		try {
			const createdUser = await this.usersService.create(
				new CreateUserDto({
					...registrationData,
					password: hashedPassword,
				}),
			);
			console.log(
				'register: ' + createdUser.login + ' created successfully, returning ✔',
			);
			return { login: createdUser.login, success: true };
		} catch (error) {
			if (error?.code === PostgresErrorCode.UniqueViolation) {
				console.error(
					'register: email: ' +
						registrationData.email +
						' and/or login: ' +
						registrationData.login +
						' already exists, returning ✘',
				);
				throw new HttpException(
					'E_EMAIL_OR_LOGIN_ALREADY_EXISTS',
					HttpStatus.BAD_REQUEST,
				);
			}
			console.error('register: unknown error: ' + error + ' returning ✘');
			throw new HttpException(
				'E_UNEXPECTED_ERROR',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	public async getAuthenticatedUser(email: string, password: string) {
		console.log('getAuthenticatedUser: starting for email / login: ' + email);
		try {
			const user = await this.usersService.getByEmail(email);
			await this.verifyPassword(password, user.password);
			console.log(
				'getAuthenticatedUser: ' +
					user.login +
					' authenticated successfully, returning ✔',
			);
			return { login: user.login, success: true };
		} catch (error) {
			try {
				const user = await this.usersService.getByLogin(email);
				if (user.password === '') {
					console.error(
						'getAuthenticatedUser: ' +
							user.login +
							' has no password, returning ✘',
					);
					throw new HttpException('E_USER_IS_FT', HttpStatus.BAD_REQUEST);
				}
				await this.verifyPassword(password, user.password);
				console.log(
					'getAuthenticatedUser: ' +
						user.login +
						' authenticated successfully, returning ✔',
				);
				return { login: user.login, success: true };
			} catch (error) {
				console.error('getAuthenticatedUser: ' + error + ' returning ✘');
				if (error.message == 'E_USER_IS_FT') {
					throw new HttpException('E_USER_IS_FT', HttpStatus.BAD_REQUEST);
				} else {
					throw new HttpException('E_PASS_FAIL', HttpStatus.BAD_REQUEST);
				}
			}
		}
	}

	private async verifyPassword(
		plainTextPassword: string,
		hashedPassword: string,
	) {
		console.log('verifyPassword: starting');
		const isPasswordMatching = await bcrypt.compare(
			plainTextPassword,
			hashedPassword,
		);
		if (!isPasswordMatching) {
			console.error('verifyPassword: ' + 'mismatch');
			throw new HttpException('E_PASS_FAIL', HttpStatus.BAD_REQUEST);
		}
		console.log('verifyPassword: ' + 'match, returning');
	}

	public async getCookieFromJwt(userId: number) {
		console.log('getCookieFromJwt: starting for userId: ' + userId);
		const jwtPayload = { userId };
		const jwt = await this.jwtService.sign(jwtPayload);
		console.log('getCookieFromJwt: ' + 'jwt created, returning ✔');
		return `Authentication=${jwt}; HttpOnly; Path=/; Max-Age=${this.configService.get(
			'JWT_MAX_AGE',
		)}`;
	}

	public getLogOutCookie() {
		console.log('getLogOutCookie: starting');
		console.log('getLogOutCookie: success, returning ✔');
		return `Authentication=; HttpOnly; Path=/; Max-Age=0`;
	}

	public async checkJwt(jwt: string) {
		console.log('checkJwt: starting');
		const jwtPayload = await this.jwtService.verify(jwt);
		console.log('checkJwt: ' + 'jwt verified, returning ✔ or ✘');
		return jwtPayload;
	}

	public async auth42(code: string): Promise<AuthResponse> {
		console.log('auth42: starting');
		if (!code) {
			console.error('auth42: ' + 'no code provided, returning ✘');
			throw new HttpException('E_NO_CODE_PROVIDED', HttpStatus.BAD_REQUEST);
		} else if ((await this.usersService.checkCodeInUse(code)) === true) {
			console.error('auth42: ' + 'code already in use, returning ✘');
			throw new HttpException('E_CODE_IN_USE', HttpStatus.BAD_REQUEST);
		}
		try {
			const response = await firstValueFrom(
				this.httpService.post('https://api.intra.42.fr/oauth/token', {
					grant_type: 'authorization_code',
					client_id: process.env.API_42_UID,
					client_secret: process.env.API_42_SECRET,
					code: code,
					redirect_uri: process.env.API_42_REDIRECT_URI,
				}),
			);
			const logobj = await firstValueFrom(
				this.httpService.get('https://api.intra.42.fr/v2/me', {
					headers: {
						Authorization: `Bearer ${response.data.access_token}`,
					},
				}),
			);
			if (
				(await this.usersService.checkEmailExistence(logobj.data.email)) == true
			) {
				await this.usersService.ft_update(
					logobj.data.email,
					response.data.access_token,
					response.data.expires_in,
					new Date(),
				);
				console.log('auth42: ' + logobj.data.login + ' updated, returning ✔');
				return { login: logobj.data.login, success: true };
			}
			try {
				const createdUser = await this.usersService.ft_create(
					new CreateUserDto({
						email: logobj.data.email,
						login: logobj.data.login,
						ft_code: code,
						ft_accessToken: response.data.access_token,
						ft_refreshToken: response.data.access_token,
						ft_expiresIn: response.data.expires_in,
						ft_tokenType: response.data.token_type,
						ft_scope: response.data.scope,
					}),
				);
				console.log(
					'auth42: ' + createdUser.login + ' created / updated, returning ✔',
				);
				// TODO set cookie in order to stay logged in
				return { login: createdUser.login, success: true };
			} catch (error) {
				console.error('auth42: unexpected error: ' + error + ' returning ✘');
				return { login: '', success: false };
			}
		} catch (error) {
			console.error('auth42: unexpected error' + error);
		}
		console.error('auth42: ' + 'unexpected error, returning ✘');
		return { login: '', success: false };
	}

	public async set_totp(email: string) {
		console.log('set_totp: starting');
		if (!email) {
			console.error('set_totp: ' + 'no email provided, returning ✘');
			throw new HttpException('E_NO_MAIL_PROVIDED', HttpStatus.BAD_REQUEST);
		} else if ((await this.usersService.checkEmailExistence(email)) === false) {
			console.error('set_totp: ' + 'email not found, returning ✘');
			throw new HttpException('E_EMAIL_NOT_FOUND', HttpStatus.BAD_REQUEST);
		}
		const secret = crypto.randomBytes(16).toString('hex').toUpperCase();
		this.usersService.change_totp_code(email, secret);
		let url = '';
		await axios
			.post('https://www.authenticatorapi.com/api.asmx/Pair', {
				appName: 'pong.io',
				appInfo: email,
				secretCode: secret,
			})
			.then((response) => {
				const elem = response.data.d.Html;
				url = /chl=(.*?)["']/.exec(elem)[1];
			})
			.catch(() => {
				console.error('compute_totp: ' + 'unexpected error, returning ✘');
				return 'unexpected error';
			});
		console.log('compute_totp: ' + 'code computed, returning ✔');
		return { url: url };
	}

	public async verify_totp(request: TotpDto) {
		console.log('verify_totp: startingfor ' + request.email);
		if (!request.email) {
			console.error('verify_totp: ' + 'no email provided, returning ✘');
			throw new HttpException('E_NO_MAIL_PROVIDED', HttpStatus.BAD_REQUEST);
		} else if (
			(await this.usersService.checkEmailExistence(request.email)) === false
		) {
			console.error('verify_totp: ' + 'email not found, returning ✘');
			throw new HttpException('E_EMAIL_NOT_FOUND', HttpStatus.BAD_REQUEST);
		}
		if (!request.code) {
			console.error('verify_totp: ' + 'no code provided, returning ✘');
			throw new HttpException('E_NO_TOTP_PROVIDED', HttpStatus.BAD_REQUEST);
		}
		if ((await this.check_totp_code(request.email, request.code)) === true) {
			console.log('verify_totp: ' + 'code match, returning ✔');
			return { success: true };
		} else {
			console.error('verify_totp: ' + 'code mismatch, returning ✘');
			return { success: false };
		}
	}

	private async check_totp_code(email: string, code: string) {
		console.log('check_totp_code: starting');
		const usr = await this.usersService.getByEmail(email);
		let truth;
		await axios
			.post('https://www.authenticatorapi.com/api.asmx/ValidatePin', {
				pin: code,
				secretCode: usr.totp_code,
			})
			.then((response) => {
				const elem = response.data.d;
				truth = /true/.exec(elem) !== null;
			})
			.catch(() => {
				console.error('compute_totp: ' + 'unexpected error, returning ✘');
				return 'unexpected error';
			});
		if (truth === true) {
			console.log('check_totp_code: ' + 'code match, returning ✔');
			return true;
		}
		console.log('check_totp_code: ' + 'code mismatch, returning ✘');
		return false;
	}
}
