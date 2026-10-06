import {describe,it,expect} from 'vitest'
import {verifyDjangoPassword,hashPassword} from '../server/auth/passwords'
import {priceCart,minorUnits,formatMoney,assertResourceQuantity} from '../server/services/money'
import fixtures from './password-fixtures.json'
describe('Django password continuity',()=>{
 it('verifies Python-derived SHA256 and Unicode SHA1 fixtures',async()=>{for(const fixture of fixtures){expect(await verifyDjangoPassword(fixture.password,fixture.encoded)).toBe(true);expect(await verifyDjangoPassword('wrong',fixture.encoded)).toBe(false)}},10000)
 it('rejects unusable, malformed and excessive-cost hashes',async()=>{for(const hash of ['!disabled','pbkdf2_sha256$999999999$salt$hash','pbkdf2_sha256$bad$salt$hash'])expect(await verifyDjangoPassword('password',hash)).toBe(false)})
 it('new hashes use the same verifiable format with fresh salts',async()=>{const hash=await hashPassword('synthetic-password');expect(await verifyDjangoPassword('synthetic-password',hash)).toBe(true)},10000)
})
describe('source financial rules',()=>{
 it('avoids binary floating-point drift and a second VAT charge',()=>{expect(priceCart([{unitPrice:'0.10',quantity:3,discount:'0.00'},{unitPrice:'112.13',quantity:1,discount:'2.10'}])).toEqual({subtotal:'112.43',discount:'2.10',tax:'0.00',total:'110.33'})})
 it('preserves decimal boundaries and rejects excess precision',()=>{expect(formatMoney(minorUnits('-0.01'))).toBe('-0.01');expect(formatMoney(minorUnits('9999999999.99'))).toBe('9999999999.99');expect(()=>minorUnits('1.001')).toThrow()})
 it('enforces one external resource per domain/hosting line',()=>{expect(()=>assertResourceQuantity('domain',2)).toThrow();expect(()=>assertResourceQuantity('hosting',0)).toThrow();expect(()=>assertResourceQuantity('domain',1)).not.toThrow()})
})
