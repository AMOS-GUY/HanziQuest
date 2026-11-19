/**
 * A Prisma client that can only read (M13, moved here for M15). Diagnostics and learning
 * measurement use it so they can never change learning history, grading or consent.
 */
import type { PrismaClient } from "@/generated/prisma/client";

const READ_METHODS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

export class ReadOnlyViolation extends Error {
  constructor(what: string) {
    super(`Replay is read-only: refused ${what}.`);
    this.name = "ReadOnlyViolation";
  }
}

/**
 * Wraps a client so that nothing reachable from it can write (M13 review R1, R4).
 *
 * The wrap is recursive: every object reachable through a property, at any depth and under
 * string or symbol keys (Prisma keeps its internal client under a symbol and under
 * `_originalClient`), is wrapped the same way. Functions may be called only if their name is a
 * read method (`find*`, `count`, `aggregate`, `groupBy`); at the top level, `$connect` and
 * `$disconnect` are also allowed. Everything else, including `$extends`, raw statements,
 * transactions and every create, update, upsert or delete, throws `ReadOnlyViolation`.
 */
export function readOnlyClient(prisma: PrismaClient): PrismaClient {
  return wrapReadOnly(prisma, "client", true) as PrismaClient;
}

const CONNECTION_METHODS = new Set(["$connect", "$disconnect"]);

function wrapReadOnly(target: object, path: string, root: boolean): object {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver) as unknown;
      const name = typeof prop === "string" ? prop : String(prop);
      if (typeof value === "function") {
        if (
          typeof prop === "string" &&
          (READ_METHODS.has(prop) || (root && CONNECTION_METHODS.has(prop)))
        )
          return (value as (...a: unknown[]) => unknown).bind(obj);
        return () => {
          throw new ReadOnlyViolation(`${path}.${name}`);
        };
      }
      if (value && typeof value === "object") return wrapReadOnly(value, `${path}.${name}`, false);
      return value;
    },
    set(_obj, prop) {
      throw new ReadOnlyViolation(`setting ${path}.${String(prop)}`);
    },
    defineProperty(_obj, prop) {
      throw new ReadOnlyViolation(`defining ${path}.${String(prop)}`);
    },
    deleteProperty(_obj, prop) {
      throw new ReadOnlyViolation(`deleting ${path}.${String(prop)}`);
    },
  });
}
