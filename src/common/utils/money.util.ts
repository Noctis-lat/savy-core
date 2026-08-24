import type { Prisma } from "../../generated/prisma/client";

type DecimalLike = Prisma.Decimal | number | { toString(): string };

/** Convert a Prisma Decimal (or plain number) to integer cents. */
export const toCents = (d: DecimalLike): number => Math.round(Number(d) * 100);
