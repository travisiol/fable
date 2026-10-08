/**
 * An in-process Solana JSON-RPC server with canned accounts, for tests and scripts/play-ui.mjs.
 * It also plays the parts of pump.fun FABLE relies on: a sent transaction carrying `create_v2`
 * creates the mint (Token-2022, with the name and ticker in its data) and the bonding curve (creator
 * from the instruction); one carrying `update_fee_shares_v2` writes the SharingConfig. Signatures
 * are verified with ed25519, so an unsigned or wrongly signed transaction is refused like on chain.
 * Failure modes for UI tests: POST /__control {"failNext": true} makes the next transaction fail
 * on chain (status err), {"dropNext": true} makes it never land.
 *
 *   node tests/fake-rpc.ts            -> prints {"url": "..."} and serves until killed
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export interface FakeAccount {
  lamports: number;
  owner: string;
  data?: Buffer;
}

export interface FakeTx {
  signature: string;
  raw: Buffer;
  err: unknown;
  slot: number;
  accountKeys: string[];
  landed: boolean;
}

export interface FakeState {
  slot: number;
  blockhash: string;
  accounts: Map<string, FakeAccount>;
  largest: Map<string, { address: string; amount: bigint; decimals: number }[]>;
  supply: Map<string, { amount: bigint; decimals: number }>;
  sent: FakeTx[];
  calls: string[];
  failNext: boolean;
  dropNext: boolean;
}

export const SYSTEM = "11111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const FEES = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const CREATE_V2 = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);
const UPDATE_SHARES_V2 = Buffer.from([111, 251, 49, 6, 78, 78, 106, 18]);
const CURVE_DISC = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);

export function tokenAccountData(mint: string, owner: string, amount: bigint): Buffer {
  const b = Buffer.alloc(165);
  Buffer.from(bs58.decode(mint)).copy(b, 0);
  Buffer.from(bs58.decode(owner)).copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1;
  return b;
}

export function mintData(decimals: number, supply: bigint): Buffer {
  const b = Buffer.alloc(82);
  b.writeBigUInt64LE(supply, 36);
  b[44] = decimals;
  b[45] = 1;
  return b;
}

export function newState(): FakeState {
  return { slot: 1000, blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", accounts: new Map(), largest: new Map(), supply: new Map(), sent: [], calls: [], failNext: false, dropNext: false };
}

function encodeAccount(a: FakeAccount | undefined) {
  if (!a) return null;
  const data = a.data ?? Buffer.alloc(0);
  return { data: [data.toString("base64"), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: data.length };
}

const pda = (seeds: Buffer[], program: string) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();

/** Applies the pump.fun effects of a landed transaction to the fake ledger. */
function execute(state: FakeState, tx: VersionedTransaction, keys: string[]) {
  for (const ix of tx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    if (program === PUMP && data.subarray(0, 8).equals(CREATE_V2)) {
      let o = 8;
      const s = () => {
        const n = data.readUInt32LE(o);
        const v = data.subarray(o + 4, o + 4 + n).toString("utf8");
        o += 4 + n;
        return v;
      };
      const name = s();
      const symbol = s();
      const uri = s();
      const creator = data.subarray(o, o + 32);
      const mint = keys[ix.accountKeyIndexes[0]];
      const curve = keys[ix.accountKeyIndexes[2]];
      state.accounts.set(mint, { lamports: 1_500_000, owner: T22, data: Buffer.concat([Buffer.alloc(166), Buffer.from(name), Buffer.from(symbol), Buffer.from(uri)]) });
      const c = Buffer.alloc(151);
      CURVE_DISC.copy(c, 0);
      c.writeBigUInt64LE(BigInt(1_073_000_000_000_000), 8);
      c.writeBigUInt64LE(BigInt(30_000_000_000), 16);
      c.writeBigUInt64LE(BigInt(793_100_000_000_000), 24);
      creator.copy(c, 49);
      state.accounts.set(curve, { lamports: 2_000_000, owner: PUMP, data: c });
    }
    if (program === FEES && data.subarray(0, 8).equals(UPDATE_SHARES_V2)) {
      const mint = keys[ix.accountKeyIndexes[4]];
      const admin = keys[ix.accountKeyIndexes[2]];
      const sc = pda([Buffer.from("sharing-config"), new PublicKey(mint).toBuffer()], FEES);
      const n = data.readUInt32LE(8);
      const holders = data.subarray(12, 12 + n * 34);
      const b = Buffer.concat([Buffer.alloc(8), Buffer.from([255, 2, 1]), new PublicKey(mint).toBuffer(), new PublicKey(admin).toBuffer(), Buffer.from([1]), data.subarray(8, 12), holders]);
      state.accounts.set(sc, { lamports: 8_000_000, owner: FEES, data: b });
      // bonding_curve.creator → sharing config
      const curve = pda([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP);
      const cur = state.accounts.get(curve);
      if (cur?.data) new PublicKey(sc).toBuffer().copy(cur.data, 49);
    }
  }
}

type Params = unknown[];

export function answer(state: FakeState, method: string, params: Params): { result?: unknown; error?: { code: number; message: string } } {
  state.calls.push(method);
  const context = { slot: state.slot, apiVersion: "2.2.0" };
  switch (method) {
    case "getHealth":
      return { result: "ok" };
    case "getSlot":
    case "getBlockHeight":
      return { result: state.slot };
    case "getBalance":
      return { result: { context, value: state.accounts.get(String(params[0]))?.lamports ?? 0 } };
    case "getAccountInfo":
      return { result: { context, value: encodeAccount(state.accounts.get(String(params[0]))) } };
    case "getMultipleAccounts":
      return { result: { context, value: (params[0] as string[]).map((k) => encodeAccount(state.accounts.get(k))) } };
    case "getTokenAccountBalance": {
      const a = state.accounts.get(String(params[0]));
      if (!a?.data) return { error: { code: -32602, message: "Invalid param: could not find account" } };
      const amount = a.data.readBigUInt64LE(64);
      return { result: { context, value: { amount: amount.toString(), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) } } };
    }
    case "getTokenSupply": {
      const s = state.supply.get(String(params[0]));
      if (!s) return { error: { code: -32602, message: "Invalid param: not a Token mint" } };
      return { result: { context, value: { amount: s.amount.toString(), decimals: s.decimals, uiAmount: Number(s.amount) / 10 ** s.decimals, uiAmountString: String(Number(s.amount) / 10 ** s.decimals) } } };
    }
    case "getTokenLargestAccounts":
      return { result: { context, value: (state.largest.get(String(params[0])) ?? []).map((l) => ({ address: l.address, amount: l.amount.toString(), decimals: l.decimals, uiAmount: 0, uiAmountString: "0" })) } };
    case "getTokenAccountsByOwner":
    case "getProgramAccounts":
      return { result: method === "getProgramAccounts" ? [] : { context, value: [] } };
    case "getLatestBlockhash":
      return { result: { context, value: { blockhash: state.blockhash, lastValidBlockHeight: state.slot + 150 } } };
    case "getSignaturesForAddress":
      return { result: [] };
    case "sendTransaction": {
      const raw = Buffer.from(String(params[0]), "base64");
      let tx: VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(raw);
      } catch {
        return { error: { code: -32602, message: "failed to deserialize transaction" } };
      }
      const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
      const msg = tx.message.serialize();
      for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
        if (!nacl.sign.detached.verify(msg, tx.signatures[i], bs58.decode(keys[i]))) return { error: { code: -32003, message: "Transaction signature verification failure" } };
      }
      const signature = bs58.encode(tx.signatures[0]);
      const fail = state.failNext;
      const drop = state.dropNext;
      state.failNext = false;
      state.dropNext = false;
      state.slot += 1;
      state.sent.push({ signature, raw, err: fail ? { InstructionError: [2, { Custom: 6002 }] } : null, slot: state.slot, accountKeys: keys, landed: !drop });
      if (!fail && !drop) execute(state, tx, keys);
      return { result: signature };
    }
    case "getSignatureStatuses": {
      const sigs = params[0] as string[];
      return {
        result: {
          context,
          value: sigs.map((s) => {
            const t = state.sent.find((x) => x.signature === s && x.landed);
            return t ? { slot: t.slot, confirmations: 1, err: t.err, status: t.err ? { Err: t.err } : { Ok: null }, confirmationStatus: "confirmed" } : null;
          }),
        },
      };
    }
    case "getTransaction": {
      const t = state.sent.find((x) => x.signature === String(params[0]) && x.landed);
      if (!t) return { result: null };
      const tx = VersionedTransaction.deserialize(t.raw);
      const n = t.accountKeys.length;
      return {
        result: {
          slot: t.slot,
          blockTime: 1_760_000_000,
          version: 0,
          meta: { err: t.err, fee: 5000, preBalances: Array(n).fill(0), postBalances: Array(n).fill(0), logMessages: [], innerInstructions: [], preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, status: t.err ? { Err: t.err } : { Ok: null } },
          transaction: {
            signatures: tx.signatures.map((s) => bs58.encode(s)),
            message: {
              header: tx.message.header,
              accountKeys: t.accountKeys,
              recentBlockhash: tx.message.recentBlockhash,
              instructions: tx.message.compiledInstructions.map((c) => ({ programIdIndex: c.programIdIndex, accounts: c.accountKeyIndexes, data: bs58.encode(c.data) })),
              addressTableLookups: [],
            },
          },
        },
      };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export async function startFakeRpc(state: FakeState = newState()): Promise<{ url: string; state: FakeState; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors).end();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, cors).end();
        return;
      }
      if (req.url === "/__control") {
        const c = parsed as { failNext?: boolean; dropNext?: boolean; advance?: number };
        if (c.failNext) state.failNext = true;
        if (c.dropNext) state.dropNext = true;
        if (c.advance) state.slot += c.advance;
        res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify({ ok: true, slot: state.slot }));
        return;
      }
      const one = (call: { id?: unknown; method: string; params?: Params }) => ({ jsonrpc: "2.0", id: call.id ?? null, ...answer(state, call.method, call.params ?? []) });
      const out = Array.isArray(parsed) ? parsed.map(one) : one(parsed as { method: string });
      res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const state = newState();
  const wallet = process.env.FAKE_WALLET;
  if (wallet) state.accounts.set(wallet, { lamports: Number(process.env.FAKE_LAMPORTS ?? 2_500_000_000), owner: SYSTEM });
  const { url } = await startFakeRpc(state);
  console.log(JSON.stringify({ url }));
}
