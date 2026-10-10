import { CanActivate, ConflictException, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import {promisify} from 'node:util';
import type { Request } from 'express';
import { Db } from './db';

export interface User { id: string; name: string; avatarUrl?:string|null; accountType?:'guest'|'account' }
const derivePassword=promisify(scrypt);
const userColumns=`id,name,CASE WHEN password_hash IS NULL THEN 'guest' ELSE 'account' END AS "accountType",CASE WHEN avatar_key IS NOT NULL THEN '/api/users/'||id||'/avatar?v='||avatar_key END AS "avatarUrl"`;
export type AuthRequest = Request & { user: User };
@Injectable()
export class AuthService {
  constructor(private readonly db: Db) {}
  async createGuest(name: string) {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 86400_000);
    await this.db.transaction(async sql => {
      await sql.query('INSERT INTO users(id,name) VALUES($1,$2)', [id, name]);
      await sql.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [this.hash(token), id, expiresAt]);
    });
    return { token, expiresAt: expiresAt.toISOString(), user: { id, name, avatarUrl:null,accountType:'guest' as const } };
  }
  async login(name:string,password:string){
    name=name.normalize('NFKC').trim();const loginName=name.toLowerCase();
    let row=(await this.db.query('SELECT id,password_hash FROM users WHERE login_name=$1',[loginName])).rows[0];
    let candidate:string|undefined;
    if(!row){const salt=randomBytes(16).toString('hex');const key=await derivePassword(password,salt,64) as Buffer;candidate=`scrypt$${salt}$${key.toString('hex')}`;}
    return this.db.transaction(async sql=>{
      if(!row){
        const inserted=(await sql.query('INSERT INTO users(id,name,login_name,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(login_name) DO NOTHING RETURNING id,password_hash',[randomUUID(),name,loginName,candidate])).rows[0];
        row=inserted??(await sql.query('SELECT id,password_hash FROM users WHERE login_name=$1',[loginName])).rows[0];
        if(!row)throw new ConflictException('Please retry login');
      }
      const [format,salt,stored]=String(row.password_hash).split('$');
      if(format!=='scrypt'||!salt||!stored||stored.length!==128)throw new UnauthorizedException('Invalid player name or password');
      const key=await derivePassword(password,salt,64) as Buffer;
      if(!timingSafeEqual(key,Buffer.from(stored,'hex')))throw new UnauthorizedException('Invalid player name or password');
      const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+30*86400_000);
      await sql.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[this.hash(token),row.id,expiresAt]);
      const user=(await sql.query<User>(`SELECT ${userColumns} FROM users WHERE id=$1`,[row.id])).rows[0]!;
      return {token,expiresAt:expiresAt.toISOString(),user};
    });
  }
  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  async authenticate(token: unknown): Promise<User> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const { rows } = await this.db.query<User>(
      `SELECT u.id,u.name,CASE WHEN u.password_hash IS NULL THEN 'guest' ELSE 'account' END AS "accountType",CASE WHEN u.avatar_key IS NOT NULL THEN '/api/users/'||u.id||'/avatar?v='||u.avatar_key END AS "avatarUrl" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [this.hash(token)]);
    if (!rows[0]) throw new UnauthorizedException();
    return rows[0];
  }
  async logout(token: string) { await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [this.hash(token)]); }
  async rename(id:string,name:string) {
    name=name.normalize('NFKC').trim();
    try{await this.db.query('UPDATE users SET name=$2,login_name=CASE WHEN login_name IS NULL THEN NULL ELSE $3 END WHERE id=$1',[id,name,name.toLowerCase()]);}
    catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('Player name already registered');throw error;}
    return (await this.db.query(`SELECT ${userColumns} FROM users WHERE id=$1`,[id])).rows[0];
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const value = req.headers.authorization;
    req.user = await this.auth.authenticate(value?.startsWith('Bearer ') ? value.slice(7) : undefined);
    return true;
  }
}
