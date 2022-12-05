/* eslint-disable @typescript-eslint/no-unused-vars */
import { HttpException, HttpStatus, Injectable, Headers } from '@nestjs/common';
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
import CheckDto from './dto/check.dto';

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
			!registrationData.login.match(/^[a-zA-Z0-9-_ ]{1,25}$/)
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
			throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
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
			throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
		}
	}

	public async getAuthenticatedUser(
		name: string,
		password: string,
		mfa: string,
	): Promise<AuthResponse> {
		console.log('getAuthenticatedUser: starting for login / email: ' + name);
		if (name == undefined || password == undefined) {
			console.error(
				'getAuthenticatedUser: name or password is undefined, returning ✘',
			);
			throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.BAD_REQUEST);
		}
		try {
			const user = await this.usersService.getByAny(name);
			if (user.password == '') {
				console.error(
					'getAuthenticatedUser: ' + name + ' has no password, returning ✘',
				);
				throw new HttpException('E_USER_IS_FT', HttpStatus.BAD_REQUEST);
			}
			if (user.totp_code !== '' && mfa === '') {
				console.error(
					'getAuthenticatedUser: ' + name + ' has totp code, returning ✘',
				);
				throw new HttpException('E_USER_HAS_TOTP', HttpStatus.BAD_REQUEST);
			} else if (user.totp_code !== '' && mfa !== '') {
				const mfa_check = await this.check_totp_code(user.login, mfa);
				if (mfa_check == false) {
					console.error(
						'getAuthenticatedUser: ' +
							name +
							' totp code check failed, returning ✘',
					);
					throw new HttpException('E_TOTP_FAIL', HttpStatus.BAD_REQUEST);
				}
			} else {
				console.log(
					'getAuthenticatedUser: ' + name + ' has no totp code, passing',
				);
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
			} else if (error.message == 'E_PASS_FAIL') {
				throw new HttpException('E_PASS_FAIL', HttpStatus.BAD_REQUEST);
			} else if (error.message == 'E_USER_NOT_FOUND') {
				throw new HttpException('E_USER_NOT_FOUND', HttpStatus.BAD_REQUEST);
			} else if (error.message == 'E_USER_HAS_TOTP') {
				throw new HttpException('E_USER_HAS_TOTP', HttpStatus.BAD_REQUEST);
			} else if (error.message == 'E_TOTP_FAIL') {
				throw new HttpException('E_TOTP_FAIL', HttpStatus.BAD_REQUEST);
			} else if (error.message == 'E_NO_NAME') {
				throw new HttpException('E_NO_NAME', HttpStatus.CONFLICT);
			} else if (error.message == 'E_NO_TOTP_PROVIDED') {
				throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
			} else if (error.message == 'E_GOOGLE_API') {
				throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
			} else {
				throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
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

	public async createCookie(login: string) {
		console.log('createCookie: starting for login: ' + login);
		const token = this.jwtService.sign({ login: login });
		await this.usersService.update_session(login, token);
		console.log('createCookie: ' + 'cookie created successfully, returning ✔');
		return { key: 'session', value: token };
	}

	public async deleteCookie(login: string) {
		console.log('deleteCookie: starting for login: ' + login);
		await this.usersService.update_session(login, '');
		console.log('deleteCookie: ' + 'cookie deleted successfully, returning ✔');
		return true;
	}

	public async validate_token(request: CheckDto) {
		// console.log('validate_token: starting ');
		try {
			// console.log(
			// 	'validate_token:',
			// 	'decoded:',
			// 	await this.jwtService.decode(request.token),
			// );
			await this.jwtService.verify(request.token);
		} catch (error) {
			console.error('validate_token: ' + 'session mismatch, returning ✘');
			throw new HttpException('E_SESSION_MISMATCH', HttpStatus.BAD_REQUEST);
		}
		// console.log('validate_token: ' + 'session valid, returning ✔');
		return true;
	}

	public async logOut(login: string) {
		console.log('logOut: starting for login: ' + login);
		await this.usersService.update_session(login, '');
		await this.usersService.set_status(login, 'offline');
		console.log('logOut: ' + 'session deleted successfully, returning ✔');
		return true;
	}

	get_login_from_cookie(@Headers() headers: any) {
		let login: string;
		try {
			login = JSON.stringify(headers.cookie)
				.split(';')
				.find((x) => x.includes('login'))
				.split('=')[1]
				.replace(/"/g, '');
		} catch (e) {
			throw new HttpException('Bad Request', 400);
		}
		return login;
	}

	// public async getCookieFromJwt(userId: number) {
	// 	console.log('getCookieFromJwt: starting for userId: ' + userId);
	// 	const jwtPayload = { userId };
	// 	const jwt = await this.jwtService.sign(jwtPayload);
	// 	console.log('getCookieFromJwt: ' + 'jwt created, returning ✔');
	// 	return `Authentication=${jwt}; HttpOnly; Path=/; Max-Age=${this.configService.get(
	// 		'JWT_MAX_AGE',
	// 	)}`;
	// }

	// public getLogOutCookie() {
	// 	console.log('getLogOutCookie: starting');
	// 	console.log('getLogOutCookie: success, returning ✔');
	// 	return `Authentication=; HttpOnly; Path=/; Max-Age=0`;
	// }

	// public async checkJwt(jwt: string) {
	// 	console.log('checkJwt: starting');
	// 	const jwtPayload = await this.jwtService.verify(jwt);
	// 	console.log('checkJwt: ' + 'jwt verified, returning ✔ or ✘');
	// 	return jwtPayload;
	// }

	find_valid_username(login: string): string {
		console.log('find_42_username: starting');
		let valid = false;
		while (valid !== true) {
			const exists = this.usersService.getByLogin(login);
			if (exists) {
				login += Math.floor(Math.random() * 10).toString();
			} else {
				valid = true;
			}
		}
		return login;
	}

	async auth_42_existing_email(
		logobj: any,
		response: any,
		code: string,
		mfa: string,
	) {
		const existing_usr = await this.usersService.getByEmail(logobj.data.email);
		if (existing_usr.password == '') {
			logobj.data.login = logobj.data.login + '_42';
			if (
				(await this.usersService.checkEmailExistence(logobj.data.email)) == true
			) {
				if (existing_usr.totp_code !== '' && mfa === '') {
					console.error(
						'auth42: ' + existing_usr.login + ' has totp code, returning ✘',
					);
					throw new HttpException('E_USER_HAS_TOTP', HttpStatus.BAD_REQUEST);
				} else if (existing_usr.totp_code !== '' && mfa !== '') {
					const mfa_check = await this.check_totp_code(existing_usr.login, mfa);
					if (mfa_check == false) {
						console.error(
							'auth42: ' +
								existing_usr.login +
								' totp code check failed, returning ✘',
						);
						throw new HttpException('E_TOTP_FAIL', HttpStatus.BAD_REQUEST);
					}
				} else {
					console.log(
						'auth42: ' + existing_usr.login + ' has no totp code, passing',
					);
				}
				await this.usersService.ft_update(
					logobj.data.email,
					response.data.access_token,
					response.data.expires_in,
					new Date(),
				);
				console.log('auth42: ' + logobj.data.login + ' updated, returning ✔');
				return { login: logobj.data.email, success: true };
			} else {
				try {
					const existing_usr = await this.usersService.getByLogin(
						logobj.data.login,
					);
					if (existing_usr) {
						logobj.data.login = logobj.data.login + '_42';
					}
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
					console.log('auth42: ' + createdUser.login + ' created, returning ✔');
					return { login: createdUser.login, success: true };
				} catch (error) {
					console.error('auth42: unexpected error: ' + error + ' returning ✘');
					throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
				}
			}
		}
		await this.usersService.ft_update(
			logobj.data.email,
			response.data.access_token,
			response.data.expires_in,
			new Date(),
		);
		console.log('auth42: ' + logobj.data.login + ' updated, returning ✔');
		return { login: logobj.data.email, success: true };
	}

	async auth_42_new_email(logobj: any, response: any, code: string) {
		// we assume that the email fetched from 42 is unique and cannot be used by another user, nor changed
		// thus, a new user is created with the email and his login, or a randomly suffixed one if the login is already taken
		try {
			const existing_usr = await this.usersService.getByLogin(
				logobj.data.login,
			);
			if (existing_usr) {
				logobj.data.login = this.find_valid_username(logobj.data.login);
			}
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
			console.log('auth42: ' + createdUser.login + ' created, returning ✔');
			return { login: createdUser.login, success: true };
		} catch (error) {
			console.error('auth42: unexpected error: ' + error + ' returning ✘');
			throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
		}
	}

	public async auth42(code: string, mfa: string): Promise<AuthResponse> {
		console.log('auth42: starting');
		// check if code is valid
		if (!code) {
			console.error('auth42: ' + 'no code provided, returning ✘');
			throw new HttpException('E_NO_CODE_PROVIDED', HttpStatus.BAD_REQUEST);
		} else if ((await this.usersService.checkCodeInUse(code)) === true) {
			console.error('auth42: ' + 'code already in use, returning ✘');
			throw new HttpException('E_CODE_IN_USE', HttpStatus.BAD_REQUEST);
		}
		// get infos from 42 api
		let logobj: any;
		let response: any;
		try {
			response = await firstValueFrom(
				this.httpService.post('https://api.intra.42.fr/oauth/token', {
					grant_type: 'authorization_code',
					client_id: process.env.API_42_UID,
					client_secret: process.env.API_42_SECRET,
					code: code,
					redirect_uri: process.env.API_42_REDIRECT_URI,
				}),
			);
			logobj = await firstValueFrom(
				this.httpService.get('https://api.intra.42.fr/v2/me', {
					headers: {
						Authorization: `Bearer ${response.data.access_token}`,
					},
				}),
			);
		} catch (error) {
			console.error('auth42: unexpected error' + error);
		}
		// proceed for user with this email (which cannot be changed manually)
		try {
			if (
				(await this.usersService.checkEmailExistence(logobj.data.email)) == true
			) {
				return await this.auth_42_existing_email(logobj, response, code, mfa);
			} else {
				return await this.auth_42_new_email(logobj, response, code);
			}
		} catch (error) {
			if (error.message == 'E_USER_HAS_TOTP') {
				throw new HttpException('E_USER_HAS_TOTP', HttpStatus.BAD_REQUEST);
			} else if (error.message == 'E_TOTP_FAIL') {
				throw new HttpException('E_TOTP_FAIL', HttpStatus.BAD_REQUEST);
			}
			console.error('auth42: unexpected error' + error);
		}
		// throw new HttpException('E_UNEXPECTED_ERROR', HttpStatus.CONFLICT);
	}

	public async set_totp(name: string) {
		console.log('set_totp: starting');
		if (!name) {
			console.error('set_totp: ' + 'no email / login provided, returning ✘');
			throw new HttpException('E_NO_MAIL_PROVIDED', HttpStatus.BAD_REQUEST);
		}
		const user = await this.usersService.getByAny(name);
		if (!user) {
			console.error('set_totp: ' + 'email / login not found, returning ✘');
			throw new HttpException('E_USER_NOT_FOUND', HttpStatus.BAD_REQUEST);
		}
		const secret = crypto.randomBytes(16).toString('hex').toUpperCase();
		this.usersService.change_totp_code(user, secret);
		let url = '';
		let img_src = '';
		await axios
			.post('https://www.authenticatorapi.com/api.asmx/Pair', {
				appName: 'pong.io',
				appInfo: user.email,
				secretCode: secret,
			})
			.then((response) => {
				const elem = response.data.d.Html;
				img_src = /src='(.*?)'/.exec(elem)[1];
				url = /chl=(.*?)["']/.exec(elem)[1];
			})
			.catch(() => {
				console.error(
					'set_totp: ' + "error with Google's TOTP API, returning ✘",
				);
				throw new HttpException('E_GOOGLE_API', HttpStatus.CONFLICT);
			});
		console.log('set_totp: ' + 'code computed, returning ✔');
		return {
			url: url,
			img_src: img_src,
		};
	}

	public async set_tmp_totp(name: string) {
		console.log('set_tmp_totp: starting');
		if (!name) {
			console.error(
				'set_tmp_totp: ' + 'no email / login provided, returning ✘',
			);
			throw new HttpException('E_NO_MAIL_PROVIDED', HttpStatus.BAD_REQUEST);
		}
		const user = await this.usersService.getByAny(name);
		if (!user) {
			console.error('set_tmp_totp: ' + 'email / login not found, returning ✘');
			throw new HttpException('E_USER_NOT_FOUND', HttpStatus.BAD_REQUEST);
		}
		const secret = crypto.randomBytes(16).toString('hex').toUpperCase();
		this.usersService.change_tmp_totp_code(user, secret);
		let url = '';
		let img_src = '';
		await axios
			.post('https://www.authenticatorapi.com/api.asmx/Pair', {
				appName: 'pong.io',
				appInfo: user.email,
				secretCode: secret,
			})
			.then((response) => {
				const elem = response.data.d.Html;
				img_src = /src='(.*?)'/.exec(elem)[1];
				url = /chl=(.*?)["']/.exec(elem)[1];
			})
			.catch(() => {
				console.error(
					'set_tmp_totp: ' + "error with Google's TOTP API, returning ✘",
				);
				throw new HttpException('E_GOOGLE_API', HttpStatus.CONFLICT);
			});
		console.log('set_tmp_totp: ' + 'code computed, returning ✔');
		return {
			url: url,
			img_src: img_src,
		};
	}

	public async verify_totp(login: string, code: string) {
		console.log('verify_totp: starting for ' + login);
		if (!login) {
			console.error('verify_totp: ' + 'no email / login provided, returning ✘');
			throw new HttpException('E_NO_NAME', HttpStatus.BAD_REQUEST);
		} else if (!code) {
			console.error('verify_totp: ' + 'no code provided, returning ✘');
			throw new HttpException('E_NO_TOTP_PROVIDED', HttpStatus.BAD_REQUEST);
		}
		try {
			if ((await this.check_totp_code(login, code)) === true) {
				console.log('verify_totp: ' + 'code match, returning ✔');
				return { success: true };
			}
		} catch (error) {
			if (error.message === 'E_GOOGLE_API') {
				console.error(
					'verify_totp: ' + "error with Google's TOTP API, returning ✘",
				);
				throw new HttpException('E_GOOGLE_API', HttpStatus.CONFLICT);
			}
		}
		console.error('verify_totp: ' + 'code mismatch, returning ✘');
		throw new HttpException('E_TOTP_MISMATCH', HttpStatus.CONFLICT);
	}

	public async verify_tmp_totp(login: string, code: string) {
		console.log('verify_tmp_totp: starting for ' + login);
		if (!login) {
			console.error(
				'verify_tmp_totp: ' + 'no email / login provided, returning ✘',
			);
			throw new HttpException('E_NO_NAME', HttpStatus.BAD_REQUEST);
		} else if (!code) {
			console.error('verify_tmp_totp: ' + 'no code provided, returning ✘');
			throw new HttpException('E_NO_TOTP_PROVIDED', HttpStatus.BAD_REQUEST);
		}
		try {
			if ((await this.check_tmp_totp_code(login, code)) === true) {
				console.log('verify_tmp_totp: ' + 'code match, returning ✔');
				this.validate_totp(login);
				return { success: true };
			}
		} catch (error) {
			if (error.message === 'E_GOOGLE_API') {
				console.error(
					'verify_tmp_totp: ' + "error with Google's TOTP API, returning ✘",
				);
				throw new HttpException('E_GOOGLE_API', HttpStatus.CONFLICT);
			}
		}
		console.error('verify_tmp_totp: ' + 'code mismatch, returning ✘');
		throw new HttpException('E_TOTP_MISMATCH', HttpStatus.CONFLICT);
	}

	private async check_totp_code(name: string, code: string) {
		console.log('check_totp_code: starting');
		const usr = await this.usersService.getByAny(name);
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
			.catch((error) => {
				console.error(
					'check_totp_code: ' + 'unexpected error : ' + error + ', returning ✘',
				);
				throw new HttpException('E_GOOGLE_API', HttpStatus.CONFLICT);
			});
		if (truth === true) {
			console.log('check_totp_code: ' + 'code match, returning ✔');
			return true;
		}
		console.log('check_totp_code: ' + 'code mismatch, returning ✘');
		return false;
	}

	private async check_tmp_totp_code(name: string, code: string) {
		console.log('check_tmp_totp_code: starting');
		const usr = await this.usersService.getByAny(name);
		let truth;
		await axios
			.post('https://www.authenticatorapi.com/api.asmx/ValidatePin', {
				pin: code,
				secretCode: usr.tmp_totp_code,
			})
			.then((response) => {
				const elem = response.data.d;
				truth = /true/.exec(elem) !== null;
			})
			.catch((error) => {
				console.error(
					'check_tmp_totp_code: ' +
						'unexpected error : ' +
						error +
						', returning ✘',
				);
				throw new HttpException('E_GOOGLE_API', HttpStatus.CONFLICT);
			});
		if (truth === true) {
			console.log('check_tmp_totp_code: ' + 'code match, returning ✔');
			return true;
		}
		console.log('check_tmp_totp_code: ' + 'code mismatch, returning ✘');
		return false;
	}

	public async validate_totp(name: string) {
		console.log('validate_totp: starting');
		const usr = await this.usersService.getByAny(name);
		usr.totp_code = usr.tmp_totp_code;
		usr.tmp_totp_code = null;
		await this.usersService.validate_totp(usr.login);
		console.log('validate_totp: ' + 'totp validated, returning ✔');
	}

	public async disable_totp(name: string) {
		console.log('disable_totp: starting');
		const usr = await this.usersService.getByAny(name);
		await this.usersService.change_totp_code(usr, '');
		await this.usersService.change_tmp_totp_code(usr, '');
		console.log('disable_totp: ' + 'totp disabled, returning ✔');
	}

	public async check_totp_status(name: string) {
		console.log('check_totp_status: starting');
		const usr = await this.usersService.getByAny(name);
		let ret;
		console.log('status:', usr.totp_code);
		if (usr.totp_code != '') {
			ret = true;
		} else {
			ret = false;
		}
		console.log('check_totp_status: ' + 'totp status computed, returning ✔');
		return ret;
	}
}
