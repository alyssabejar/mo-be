import type { JwtClaims } from "@mamamo/contracts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { keyVerifier, type TokenVerifier } from "./auth";

/** A local signing key for tests: sign tokens and verify them without identity-service. */
export async function testKeys(): Promise<{ sign: (c: JwtClaims) => Promise<string>; verifier: TokenVerifier; publicJwk: object }> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  return {
    sign: (c) => new SignJWT({ ...c }).setProtectedHeader({ alg: "EdDSA" }).setSubject(c.sub).setIssuedAt().setExpirationTime("1h").sign(privateKey),
    verifier: keyVerifier(publicKey),
    publicJwk: await exportJWK(publicKey),
  };
}
