import { createCipheriv } from "node:crypto";

// The CAU CAS login page uses a legacy DES implementation whose key-bit
// permutation differs from standard DES. Re-map its 56 effective key bits to
// a standard DES key, then use Node's audited cipher implementation.
const standardPc1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2,
  59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39,
  31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37,
  29, 21, 13, 5, 28, 20, 12, 4,
];
const cauPc1 = Array.from({ length: 7 }, (_, row) =>
  Array.from({ length: 8 }, (_, column) => 8 * (7 - column) + row + 1)
).flat();

function stringBlock(value: string) {
  const block = Buffer.alloc(8);
  for (let index = 0; index < Math.min(value.length, 4); index++) block.writeUInt16BE(value.charCodeAt(index), index * 2);
  return block;
}

function bit(buffer: Buffer, position: number) {
  return (buffer[Math.floor(position / 8)] >> (7 - position % 8)) & 1;
}

function cauKey(value: string) {
  const source = stringBlock(value);
  const key = Buffer.alloc(8);
  for (let index = 0; index < standardPc1.length; index++) {
    const valueBit = bit(source, cauPc1[index] - 1);
    const destination = standardPc1[index] - 1;
    key[Math.floor(destination / 8)] |= valueBit << (7 - destination % 8);
  }
  // des-ede3 with K1=K2=K3 is equivalent to single DES, which OpenSSL 3 no
  // longer exposes directly. CAU applies three separate DES encryptions.
  return Buffer.concat([key, key, key]);
}

function encryptBlock(block: Buffer, key: string) {
  const cipher = createCipheriv("des-ede3", cauKey(key), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

export function cauLoginCipher(value: string) {
  const encrypted: Buffer[] = [];
  for (let offset = 0; offset < value.length; offset += 4) {
    let block = stringBlock(value.slice(offset, offset + 4));
    for (const key of ["1", "2", "3"]) block = encryptBlock(block, key);
    encrypted.push(block);
  }
  return Buffer.concat(encrypted).toString("hex").toUpperCase();
}
