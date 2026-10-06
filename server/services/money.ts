/** Exact two-decimal arithmetic; mirrors source cart pricing, without adding VAT twice. */
export function minorUnits(value: string): bigint {
 if(!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid monetary amount')
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.')
 return (BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(negative?-1n:1n)
}
export function formatMoney(value: bigint): string {
 const absolute=value<0n?-value:value
 return `${value<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`
}
export function priceCart(items: readonly {unitPrice:string;quantity:number;discount:string}[]) {
 let subtotal=0n,discount=0n
 for(const item of items){if(!Number.isSafeInteger(item.quantity)||item.quantity<1)throw new Error('Invalid quantity');subtotal+=minorUnits(item.unitPrice)*BigInt(item.quantity);discount+=minorUnits(item.discount)}
 return {subtotal:formatMoney(subtotal),discount:formatMoney(discount),tax:'0.00',total:formatMoney(subtotal-discount)}
}
export function assertResourceQuantity(productType:string, quantity:number) {
 if(['domain','hosting'].includes(productType)&&quantity!==1)throw new Error('Domain and hosting purchases must have quantity 1')
}
