import { describe, it, expect } from "vitest";
import { defaultTokenStore } from "./store.js";
import { FileTokenStore } from "./tokenStore.js";
import { KeychainTokenStore } from "./keychainStore.js";

describe("defaultTokenStore", () => {
  it("honors MATRIX_TOKEN_STORE=file", () => {
    expect(defaultTokenStore({ MATRIX_TOKEN_STORE: "file" } as NodeJS.ProcessEnv)).toBeInstanceOf(FileTokenStore);
  });
  it("honors MATRIX_TOKEN_STORE=keychain", () => {
    expect(defaultTokenStore({ MATRIX_TOKEN_STORE: "keychain" } as NodeJS.ProcessEnv)).toBeInstanceOf(KeychainTokenStore);
  });
});
