import type { TokenStore } from "./tokenStore.js";
import { FileTokenStore } from "./tokenStore.js";
import { KeychainTokenStore } from "./keychainStore.js";

/**
 * Pick the token backend: macOS Keychain by default on darwin, a 0600 file
 * elsewhere. Override with MATRIX_TOKEN_STORE=keychain|file (e.g. to force the
 * file store if `security` is unavailable).
 */
export function defaultTokenStore(env: NodeJS.ProcessEnv = process.env): TokenStore {
  const pref = env.MATRIX_TOKEN_STORE;
  if (pref === "file") return new FileTokenStore();
  if (pref === "keychain") return new KeychainTokenStore();
  return process.platform === "darwin" ? new KeychainTokenStore() : new FileTokenStore();
}
