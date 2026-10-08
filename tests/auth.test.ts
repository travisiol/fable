/** Sign-in by signed message: a nonce is single-use, the signature must match the address and message. */
import { test } from "node:test";
import assert from "node:assert/strict";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { memoryDb } from "../src/server/db.ts";
import { issueNonce, verifySignIn } from "../src/server/auth.ts";
import { signInMessage } from "../src/lib/signin-message.ts";

test("valid signature signs in once; replay, wrong key and wrong host are refused", async () => {
  const db = await memoryDb();
  const kp = nacl.sign.keyPair();
  const address = bs58.encode(kp.publicKey);
  const issuedAt = new Date().toISOString();
  const host = "localhost:3982";
  const nonce = await issueNonce(db);
  const sign = (msg: string, key = kp.secretKey) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), key));
  const signature = sign(signInMessage({ host, address, nonce, issuedAt }));
  assert.equal(await verifySignIn(db, { host, address, nonce, issuedAt, signature }), address);
  await assert.rejects(verifySignIn(db, { host, address, nonce, issuedAt, signature }), /expired/);
  const n2 = await issueNonce(db);
  const other = nacl.sign.keyPair();
  await assert.rejects(verifySignIn(db, { host, address, nonce: n2, issuedAt, signature: sign(signInMessage({ host, address, nonce: n2, issuedAt }), other.secretKey) }), /does not match/);
  const n3 = await issueNonce(db);
  await assert.rejects(verifySignIn(db, { host: "evil.example", address, nonce: n3, issuedAt, signature: sign(signInMessage({ host, address, nonce: n3, issuedAt })) }), /does not match/);
});
