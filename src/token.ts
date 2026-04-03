import jwt from "jsonwebtoken";

const JWT_ISSUER = "forta:auth-service";
const JWT_ACCESS_TOKEN_TYPE = "access";

interface FortaClaims extends jwt.JwtPayload {
  typ: string;
}

/**
 * validateAccessTokenLocal validates tokenStr using the shared HMAC-SHA512
 * signing key. Returns the Forta user ID on success. Throws on invalid tokens.
 */
export function validateAccessTokenLocal(
  tokenStr: string,
  signingKey: string
): number {
  const decoded = jwt.verify(tokenStr, signingKey, {
    algorithms: ["HS512"],
    issuer: JWT_ISSUER,
  }) as FortaClaims;

  if (decoded.typ !== JWT_ACCESS_TOKEN_TYPE) {
    throw new Error(
      `forta-js: expected token type "${JWT_ACCESS_TOKEN_TYPE}", got "${decoded.typ}"`
    );
  }

  const id = parseInt(decoded.sub || "", 10);
  if (isNaN(id)) {
    throw new Error("forta-js: invalid subject in token");
  }

  return id;
}

/**
 * isTokenExpiredError returns true when err indicates the JWT has expired (as
 * opposed to being malformed or having the wrong signing key).
 */
export function isTokenExpiredError(err: unknown): boolean {
  return err instanceof jwt.TokenExpiredError;
}
