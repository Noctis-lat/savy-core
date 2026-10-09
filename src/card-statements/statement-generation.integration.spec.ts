import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { CreditCalculationService } from "../credit-cards/calculations/credit-calculation.service";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StatementGenerationService } from "./statement-generation.service";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Integration tests for the statement generation lifecycle.
 *
 * Layers under test: StatementGenerationService + the REAL CreditCalculationService
 * (Banxico formulas, business-day math, Mexican holidays), wired through Nest DI.
 *
 * Only the persistence boundary is faked: a small stateful in-memory store
 * implements the Prisma delegates the generator uses, so state written by one
 * generation run is visible to the next (idempotency, plan advancement, linking).
 *
 * Known limitation of the fake: `$transaction` runs the callback directly and does
 * NOT roll back on failure, so all-or-nothing semantics are covered by unit tests
 * (and Postgres at runtime), not here. No live database is touched.
 *
 * Balance convention follows the specs: CREDIT account balance > 0 means debt.
 */

// ─── In-memory fake persistence ─────────────────────────────────────────

interface FakeTransaction {
	id: string;
	accountId: string;
	destinationAccountId: string | null;
	type: "EXPENSE" | "PAYMENT" | "INCOME" | "TRANSFER" | "INSTALLMENT";
	amount: Decimal;
	date: Date;
	statementId: string | null;
	commissionType: string | null;
	description?: string | null;
	installmentPlanId?: string | null;
	installmentNumber?: number | null;
}

interface FakeStatement {
	id: string;
	creditCardId: string;
	periodStart: Date;
	periodEnd: Date;
	balance: Decimal;
	minPayment: Decimal;
	noInterestPayment: Decimal;
	interestAmount: Decimal;
	paymentDueDate: Date | null;
	paidAmount: Decimal;
	isPaid: boolean;
	isGenerated: boolean;
}

interface FakePlan {
	id: string;
	transactionId: string;
	type: "MSI" | "MSCI";
	totalMonths: number;
	currentMonth: number;
	monthlyAmount: Decimal;
	interestRate: Decimal | null;
	status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "PAID_OFF";
}

interface DateFilter {
	gte?: Date;
	gt?: Date;
	lte?: Date;
	lt?: Date;
}

interface TxWhere {
	id?: { in: string[] };
	accountId?: string;
	destinationAccountId?: string;
	type?: string | { not: string };
	statementId?: string | null;
	date?: DateFilter;
	OR?: TxWhere[];
}

const CARD_ACCOUNT_ID = "acc-credit";
const DEBIT_ACCOUNT_ID = "acc-debit";
const CARD_ID = "card-1";

class FakeStore {
	accountBalance: Decimal;
	transactions: FakeTransaction[] = [];
	statements: FakeStatement[] = [];
	plans: FakePlan[] = [];
	private seq = 0;

	constructor(initialBalance: Decimal) {
		this.accountBalance = initialBalance;
	}

	nextId(prefix: string): string {
		this.seq += 1;
		return `${prefix}-${this.seq}`;
	}

	/** Adds a card EXPENSE and moves the debt balance up (positive = debt). */
	addExpense(
		amount: number,
		date: Date,
		commissionType: string | null = null,
		description: string | null = null,
	): FakeTransaction {
		const t: FakeTransaction = {
			id: this.nextId("tx"),
			accountId: CARD_ACCOUNT_ID,
			destinationAccountId: null,
			type: "EXPENSE",
			amount: new Decimal(amount),
			date,
			statementId: null,
			commissionType,
			description,
		};
		this.transactions.push(t);
		this.accountBalance = this.accountBalance.add(amount);
		return t;
	}

	/** Adds a PAYMENT from the debit account to the card and moves the debt down. */
	addPayment(amount: number, date: Date): FakeTransaction {
		const t: FakeTransaction = {
			id: this.nextId("tx"),
			accountId: DEBIT_ACCOUNT_ID,
			destinationAccountId: CARD_ACCOUNT_ID,
			type: "PAYMENT",
			amount: new Decimal(amount),
			date,
			statementId: null,
			commissionType: null,
		};
		this.transactions.push(t);
		this.accountBalance = this.accountBalance.sub(amount);
		return t;
	}

	addPlan(
		transactionId: string,
		plan: Pick<FakePlan, "type" | "totalMonths" | "monthlyAmount" | "interestRate">,
	): FakePlan {
		const p: FakePlan = {
			id: this.nextId("plan"),
			transactionId,
			currentMonth: 0,
			status: "ACTIVE",
			...plan,
		};
		this.plans.push(p);
		return p;
	}

	private matchesDate(date: Date, f?: DateFilter): boolean {
		if (!f) return true;
		const t = date.getTime();
		return (
			(f.gte === undefined || t >= f.gte.getTime()) &&
			(f.gt === undefined || t > f.gt.getTime()) &&
			(f.lte === undefined || t <= f.lte.getTime()) &&
			(f.lt === undefined || t < f.lt.getTime())
		);
	}

	matches(t: FakeTransaction, where: TxWhere): boolean {
		if (where.id && !where.id.in.includes(t.id)) return false;
		if (where.accountId !== undefined && t.accountId !== where.accountId) return false;
		if (
			where.destinationAccountId !== undefined &&
			t.destinationAccountId !== where.destinationAccountId
		) {
			return false;
		}
		if (typeof where.type === "string" && t.type !== where.type) return false;
		if (typeof where.type === "object" && t.type === where.type.not) return false;
		if (where.statementId !== undefined && t.statementId !== where.statementId) return false;
		if (!this.matchesDate(t.date, where.date)) return false;
		if (where.OR && !where.OR.some((clause) => this.matches(t, clause))) return false;
		return true;
	}

	/** Builds the object passed to the `$transaction` callback. */
	buildTx() {
		return {
			cardStatement: {
				findFirst: async ({ where }: { where: { creditCardId: string } }) => {
					const own = this.statements.filter((s) => s.creditCardId === where.creditCardId);
					own.sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
					return own[0] ?? null;
				},
				findUnique: async ({
					where,
				}: {
					where: { creditCardId_periodStart: { creditCardId: string; periodStart: Date } };
				}) => {
					const key = where.creditCardId_periodStart;
					return (
						this.statements.find(
							(s) =>
								s.creditCardId === key.creditCardId &&
								s.periodStart.getTime() === key.periodStart.getTime(),
						) ?? null
					);
				},
				create: async ({ data }: { data: Partial<FakeStatement> }) => {
					const created: FakeStatement = {
						id: this.nextId("stmt"),
						paidAmount: new Decimal(0),
						isPaid: false,
						isGenerated: false,
						paymentDueDate: null,
						...data,
					} as FakeStatement;
					this.statements.push(created);
					return created;
				},
			},
			transaction: {
				findMany: async ({ where }: { where: TxWhere }) =>
					this.transactions.filter((t) => this.matches(t, where)),
				updateMany: async ({ where, data }: { where: TxWhere; data: { statementId: string } }) => {
					const hit = this.transactions.filter((t) => this.matches(t, where));
					for (const t of hit) t.statementId = data.statementId;
					return { count: hit.length };
				},
				create: async ({ data }: { data: Record<string, unknown> }) => {
					const created = {
						id: this.nextId("tx"),
						destinationAccountId: null,
						statementId: null,
						commissionType: null,
						...data,
					} as Record<string, unknown>;
					this.transactions.push(created as never);
					return created;
				},
			},
			installmentPlan: {
				findMany: async ({
					where,
				}: {
					where: { status: string; transaction: { accountId: string; date?: DateFilter } };
				}) =>
					this.plans
						.filter((p) => p.status === where.status)
						.map((p) => ({
							...p,
							transaction: this.transactions.find((t) => t.id === p.transactionId),
						}))
						.filter(
							(p) =>
								p.transaction !== undefined &&
								p.transaction.accountId === where.transaction.accountId &&
								this.matchesDate(p.transaction.date, where.transaction.date),
						),
				update: async ({ where, data }: { where: { id: string }; data: Partial<FakePlan> }) => {
					const plan = this.plans.find((p) => p.id === where.id);
					if (!plan) throw new Error(`plan ${where.id} not found`);
					Object.assign(plan, data);
					return plan;
				},
			},
			account: {
				findFirst: async () => ({ id: CARD_ACCOUNT_ID, balance: this.accountBalance }),
				update: async ({ data }: { data: { balance: { increment: number } } }) => {
					if (data.balance && typeof data.balance === "object" && "increment" in data.balance) {
						this.accountBalance = new Decimal(this.accountBalance).add(data.balance.increment);
					}
					return { id: CARD_ACCOUNT_ID, balance: this.accountBalance };
				},
			},
		};
	}
}

// ─── Harness ────────────────────────────────────────────────────────────

async function buildHarness(store: FakeStore, cutDay = 15) {
	const card = {
		id: CARD_ID,
		accountId: CARD_ACCOUNT_ID,
		cutDay,
		interestRate: new Decimal("0.36"),
		creditLimit: new Decimal(20000),
		paymentDueDays: 20,
	};
	const prisma = {
		creditCard: { findMany: jest.fn().mockResolvedValue([card]) },
		$transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(store.buildTx())),
	};
	const config = {
		get: (key: string) =>
			key === "CREDIT_CARD_REACTIVE_ENABLED"
				? "true"
				: key === "CREDIT_CARD_MAX_CATCH_UP_PERIODS"
					? "12"
					: undefined,
	};
	const moduleRef = await Test.createTestingModule({
		providers: [
			StatementGenerationService,
			CreditCalculationService, // REAL calculation engine
			{ provide: PrismaService, useValue: prisma },
			{ provide: ConfigService, useValue: config },
		],
	}).compile();
	return { service: moduleRef.get(StatementGenerationService), prisma };
}

/** Runs generatePending with the clock pinned to `now`. */
async function generateAt(service: StatementGenerationService, now: Date): Promise<void> {
	const realNow = Date.now;
	Date.now = jest.fn(() => now.getTime());
	try {
		await service.generatePending("profile-1");
	} finally {
		Date.now = realNow;
	}
}

function latest(store: FakeStore): FakeStatement {
	return store.statements[store.statements.length - 1];
}

function installmentRows(store: FakeStore): FakeTransaction[] {
	return store.transactions.filter((t) => t.type === "INSTALLMENT");
}

// ─── T-057 / T-058: statement generation lifecycle ──────────────────────

describe("Statement generation lifecycle (integration)", () => {
	it("generates a frozen statement from transactions → interest → minPayment → paymentDueDate", async () => {
		const store = new FakeStore(new Decimal(0));
		const t1 = store.addExpense(1000, new Date(2026, 8, 20)); // Sep 20
		const t2 = store.addExpense(2000, new Date(2026, 9, 1)); // Oct 1
		const t3 = store.addExpense(500, new Date(2026, 9, 10)); // Oct 10
		// Dated after the Sep 16 – Oct 15 period: must not leak into statement 1
		const tAfter = store.addExpense(400, new Date(2026, 9, 16));
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16)); // Oct 16

		expect(store.statements).toHaveLength(1);
		const s = store.statements[0];
		expect(s.isGenerated).toBe(true);
		expect(s.creditCardId).toBe(CARD_ID);
		expect(s.periodStart).toEqual(new Date(2026, 8, 16));
		expect(s.periodEnd.getFullYear()).toBe(2026);
		expect(s.periodEnd.getMonth()).toBe(9);
		expect(s.periodEnd.getDate()).toBe(15);

		// Balance at cut = 1000 + 2000 + 500 (the 400 charge belongs to the next period)
		expect(s.balance.toFixed(2)).toBe("3500.00");
		// First statement has no previous period → no interest
		expect(s.interestAmount.toFixed(2)).toBe("0.00");
		// No installment plans → PNGI equals the statement balance
		expect(s.noInterestPayment.toFixed(2)).toBe("3500.00");
		// Formula (a) = 1.5% × 3500 = 52.50; formula (b) = 1.25% × 20000 = 250 → (b) wins
		expect(s.minPayment.toFixed(2)).toBe("250.00");
		// Oct 15 + 20 days = Nov 4, 2026 (Wednesday, business day)
		expect(s.paymentDueDate).toEqual(new Date(2026, 10, 4));

		// Period transactions are linked; the later one is not
		expect([t1.statementId, t2.statementId, t3.statementId]).toEqual([s.id, s.id, s.id]);
		expect(tAfter.statementId).toBeNull();
	});

	it("is idempotent: a second read the same day creates no duplicate", async () => {
		const store = new FakeStore(new Decimal(0));
		store.addExpense(1000, new Date(2026, 8, 20));
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));
		await generateAt(service, new Date(2026, 9, 16));

		expect(store.statements).toHaveLength(1);
	});

	it("charges IVA-inclusive interest when the previous statement was not paid in full", async () => {
		const store = new FakeStore(new Decimal(0));
		store.addExpense(1000, new Date(2026, 8, 20));
		store.addExpense(2000, new Date(2026, 9, 1));
		store.addExpense(500, new Date(2026, 9, 10));
		store.addExpense(400, new Date(2026, 9, 16)); // period 2 purchase
		const { service } = await buildHarness(store);
		await generateAt(service, new Date(2026, 9, 16));
		expect(store.statements).toHaveLength(1);

		// Partial payment of 1000 on Oct 25 is applied to statement 1 (< 3500 PNGI)
		const payment = store.addPayment(1000, new Date(2026, 9, 25));
		store.statements[0].paidAmount = new Decimal(1000);

		await generateAt(service, new Date(2026, 10, 16)); // Nov 16

		expect(store.statements).toHaveLength(2);
		const s2 = store.statements[1];
		expect(s2.periodStart).toEqual(new Date(2026, 9, 16));

		// Balance at cut = 3500 + 400 - 1000
		expect(s2.balance.toFixed(2)).toBe("2900.00");
		// Daily balances (31 days): 9 × 3900 (Oct 16-24) + 22 × 2900 (Oct 25 - Nov 15) = 98,900
		// ADB × (0.36 / 360) × 31 = 98.90 pre-IVA; × 1.16 = 114.724 → 114.72
		expect(s2.interestAmount.toFixed(2)).toBe("114.72");
		expect(s2.noInterestPayment.toFixed(2)).toBe("2900.00");
		// (a) = 1.5% × 2900 + 114.724 = 158.22 < (b) = 250
		expect(s2.minPayment.toFixed(2)).toBe("250.00");
		// Nov 15 + 20 days = Sat Dec 5 → next business day Mon Dec 7
		expect(s2.paymentDueDate).toEqual(new Date(2026, 11, 7));
		expect(payment.statementId).toBe(s2.id);
	});

	it("charges no interest when the previous statement was paid at least in full", async () => {
		const store = new FakeStore(new Decimal(0));
		store.addExpense(3000, new Date(2026, 9, 5));
		const { service } = await buildHarness(store);
		await generateAt(service, new Date(2026, 9, 16));

		store.addPayment(3000, new Date(2026, 9, 25));
		store.statements[0].paidAmount = new Decimal(3000);
		await generateAt(service, new Date(2026, 10, 16));

		expect(store.statements).toHaveLength(2);
		expect(store.statements[1].balance.toFixed(2)).toBe("0.00");
		expect(store.statements[1].interestAmount.toFixed(2)).toBe("0.00");
		expect(store.statements[1].minPayment.toFixed(2)).toBe("0.00");
	});

	it("catches up three missed periods in order, charging interest on unpaid prior statements", async () => {
		const store = new FakeStore(new Decimal(0));
		store.addExpense(1200, new Date(2026, 7, 1)); // Aug 1 → period 1
		store.addExpense(800, new Date(2026, 8, 1)); // Sep 1 → period 2
		// Statement for Jun 16 – Jul 15 already exists and carries nothing to pay
		store.statements.push({
			id: "stmt-seed",
			creditCardId: CARD_ID,
			periodStart: new Date(2026, 5, 16),
			periodEnd: new Date(2026, 6, 15, 23, 59, 59, 999),
			balance: new Decimal(0),
			minPayment: new Decimal(0),
			noInterestPayment: new Decimal(0),
			interestAmount: new Decimal(0),
			paymentDueDate: null,
			paidAmount: new Decimal(0),
			isPaid: false,
			isGenerated: true,
		});
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 20)); // Oct 20

		expect(store.statements).toHaveLength(4);
		const [, p1, p2, p3] = store.statements;
		expect(p1.periodStart).toEqual(new Date(2026, 6, 16));
		expect(p2.periodStart).toEqual(new Date(2026, 7, 16));
		expect(p3.periodStart).toEqual(new Date(2026, 8, 16));

		// Each period is frozen at its own cut, not at today's balance
		expect(p1.balance.toFixed(2)).toBe("1200.00");
		// p2: 1200 (p1) + 800 expense = 2000. Interest is charged after freeze, not included.
		expect(p2.balance.toFixed(2)).toBe("2000.00");
		// p3: 2000 + 57.07 interest from p2 (materialized as transaction, incremented account balance)
		expect(p3.balance.toFixed(2)).toBe("2057.07");

		// Previous statement carried nothing to pay → no interest on period 1
		expect(p1.interestAmount.toFixed(2)).toBe("0.00");
		// Period 2: (16 × 1200 + 15 × 2000) / 31 × 0.001 × 31 = 49.20 × 1.16 = 57.072
		expect(p2.interestAmount.toFixed(2)).toBe("57.07");
		// Period 3: balance is now 2057.07 (2000 + 57.07 interest from p2, materialized as transaction)
		// 2057.07 × 0.001 × 30 = 61.712 × 1.16 = 71.586 → 71.59
		expect(p3.interestAmount.toFixed(2)).toBe("71.59");
	});

	it("reports a saldo a favor as owing nothing", async () => {
		const store = new FakeStore(new Decimal(0));
		store.addPayment(1500, new Date(2026, 9, 5)); // overpayment → balance -1500
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));

		const s = latest(store);
		expect(s.balance.toFixed(2)).toBe("-1500.00");
		expect(s.noInterestPayment.toFixed(2)).toBe("0.00");
		expect(s.minPayment.toFixed(2)).toBe("0.00");
		expect(s.interestAmount.toFixed(2)).toBe("0.00");
	});

	it("excludes MSCI plan principal from PNGI but includes the monthly payment", async () => {
		const store = new FakeStore(new Decimal(0));
		const purchase = store.addExpense(6000, new Date(2026, 9, 5)); // Oct 5
		store.addPlan(purchase.id, {
			type: "MSCI",
			totalMonths: 12,
			monthlyAmount: new Decimal(560), // 6000/12 + 6000 × 0.12 / 12
			interestRate: new Decimal("0.12"),
		});
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));

		const s = latest(store);
		// Full purchase consumed the card immediately
		expect(s.balance.toFixed(2)).toBe("6000.00");
		// PNGI = 6000 - 6000 (remaining principal) + 560 (current mensualidad)
		expect(s.noInterestPayment.toFixed(2)).toBe("560.00");
		// Plan advanced one month
		expect(store.plans[0].currentMonth).toBe(1);
		expect(store.plans[0].status).toBe("ACTIVE");
	});
});

// ─── T-059 / T-060: installment plan lifecycle ──────────────────────────

describe("Installment plan lifecycle across statements (integration)", () => {
	it("advances MSI 3 months 0→1→2→3, completes on the 3rd and excludes it from the 4th", async () => {
		const store = new FakeStore(new Decimal(0));
		const purchase = store.addExpense(3000, new Date(2026, 9, 5)); // Oct 5
		const plan = store.addPlan(purchase.id, {
			type: "MSI",
			totalMonths: 3,
			monthlyAmount: new Decimal(1000),
			interestRate: null,
		});
		const { service } = await buildHarness(store);

		// ── Statement 1 (Sep 16 – Oct 15) ──
		await generateAt(service, new Date(2026, 9, 16));
		const s1 = latest(store);
		expect(s1.balance.toFixed(2)).toBe("3000.00");
		// PNGI = 3000 - 3000 (remaining) + 1000 (mensualidad 1)
		expect(s1.noInterestPayment.toFixed(2)).toBe("1000.00");
		expect(plan.currentMonth).toBe(1);
		expect(plan.status).toBe("ACTIVE");

		// User pays the mensualidad (applied to statement 1)
		store.addPayment(1000, new Date(2026, 9, 20));
		s1.paidAmount = new Decimal(1000);

		// ── Statement 2 (Oct 16 – Nov 15) ──
		await generateAt(service, new Date(2026, 10, 16));
		const s2 = latest(store);
		expect(s2.balance.toFixed(2)).toBe("2000.00");
		// PNGI = 2000 - 2000 (remaining) + 1000
		expect(s2.noInterestPayment.toFixed(2)).toBe("1000.00");
		expect(s2.interestAmount.toFixed(2)).toBe("0.00"); // previous paid in full
		expect(plan.currentMonth).toBe(2);
		expect(plan.status).toBe("ACTIVE");

		store.addPayment(1000, new Date(2026, 10, 20));
		s2.paidAmount = new Decimal(1000);

		// ── Statement 3 (Nov 16 – Dec 15): final mensualidad ──
		await generateAt(service, new Date(2026, 11, 16));
		const s3 = latest(store);
		expect(s3.balance.toFixed(2)).toBe("1000.00");
		// PNGI = 1000 - 1000 (remaining) + 1000
		expect(s3.noInterestPayment.toFixed(2)).toBe("1000.00");
		expect(plan.currentMonth).toBe(3);
		expect(plan.status).toBe("COMPLETED");

		store.addPayment(1000, new Date(2026, 11, 20));
		s3.paidAmount = new Decimal(1000);

		// ── Statement 4 (Dec 16 – Jan 15): completed plan no longer counted ──
		await generateAt(service, new Date(2027, 0, 16));
		const s4 = latest(store);
		expect(store.statements).toHaveLength(4);
		expect(s4.balance.toFixed(2)).toBe("0.00");
		expect(s4.noInterestPayment.toFixed(2)).toBe("0.00");
		expect(plan.currentMonth).toBe(3); // not advanced again
		expect(plan.status).toBe("COMPLETED");
	});

	it("does not include or advance a plan purchased after the statement period", async () => {
		const store = new FakeStore(new Decimal(0));
		const early = store.addExpense(1000, new Date(2026, 8, 20)); // in period 1
		const late = store.addExpense(2400, new Date(2026, 9, 20)); // Oct 20: period 2
		store.addPlan(late.id, {
			type: "MSI",
			totalMonths: 12,
			monthlyAmount: new Decimal(200),
			interestRate: null,
		});
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16)); // only period 1 is due

		const s1 = latest(store);
		expect(early.statementId).toBe(s1.id);
		expect(late.statementId).toBeNull();
		expect(s1.balance.toFixed(2)).toBe("1000.00");
		expect(s1.noInterestPayment.toFixed(2)).toBe("1000.00");
		expect(store.plans[0].currentMonth).toBe(0);
	});
});

// ─── T-066 / T-067: installment transactions per cut ────────────────────

describe("Installment transactions billed at each cut (integration)", () => {
	it("bills MSI 1/3, 2/3, 3/3 in three consecutive statements without touching the balance", async () => {
		const store = new FakeStore(new Decimal(0));
		const purchase = store.addExpense(3000, new Date(2026, 9, 5), null, "Laptop"); // Oct 5
		const plan = store.addPlan(purchase.id, {
			type: "MSI",
			totalMonths: 3,
			monthlyAmount: new Decimal(1000),
			interestRate: null,
		});
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));
		const s1 = latest(store);
		// Installment rows never move the debt: the full purchase already counted
		expect(store.accountBalance.toFixed(2)).toBe("3000.00");
		store.addPayment(1000, new Date(2026, 9, 20));
		s1.paidAmount = new Decimal(1000);

		await generateAt(service, new Date(2026, 10, 16));
		const s2 = latest(store);
		expect(store.accountBalance.toFixed(2)).toBe("2000.00");
		store.addPayment(1000, new Date(2026, 10, 20));
		s2.paidAmount = new Decimal(1000);

		await generateAt(service, new Date(2026, 11, 16));
		const s3 = latest(store);
		store.addPayment(1000, new Date(2026, 11, 20));
		s3.paidAmount = new Decimal(1000);

		await generateAt(service, new Date(2027, 0, 16));
		const s4 = latest(store);

		const rows = installmentRows(store);
		expect(rows.map((r) => [r.statementId, r.installmentNumber, r.description])).toEqual([
			[s1.id, 1, "Laptop (1/3)"],
			[s2.id, 2, "Laptop (2/3)"],
			[s3.id, 3, "Laptop (3/3)"],
		]);
		for (const row of rows) {
			expect(row.installmentPlanId).toBe(plan.id);
			expect(row.accountId).toBe(CARD_ACCOUNT_ID);
			expect(row.amount.toString()).toBe("1000");
		}
		// Each row is dated on its statement's cut day
		expect(rows.map((r) => r.date)).toEqual([s1.periodEnd, s2.periodEnd, s3.periodEnd]);
		// Frozen statements are unchanged by the informational rows
		expect([s1.balance, s2.balance, s3.balance, s4.balance].map((b) => b.toFixed(2))).toEqual([
			"3000.00",
			"2000.00",
			"1000.00",
			"0.00",
		]);
		expect(s4.noInterestPayment.toFixed(2)).toBe("0.00");
		expect(store.accountBalance.toFixed(2)).toBe("0.00");
		expect(plan.status).toBe("COMPLETED");
		// No 4th installment once the plan is completed
		expect(rows.some((r) => r.statementId === s4.id)).toBe(false);
	});

	it("uses a fallback description when the purchase has none", async () => {
		const store = new FakeStore(new Decimal(0));
		const purchase = store.addExpense(1200, new Date(2026, 9, 5));
		store.addPlan(purchase.id, {
			type: "MSI",
			totalMonths: 6,
			monthlyAmount: new Decimal(200),
			interestRate: null,
		});
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));

		const [row] = installmentRows(store);
		expect(row.description).toBe("Installment purchase (1/6)");
		expect(row.amount.toString()).toBe("200");
	});

	it("does not bill a plan purchased after the statement period", async () => {
		const store = new FakeStore(new Decimal(0));
		const late = store.addExpense(2400, new Date(2026, 9, 20)); // Oct 20: next period
		store.addPlan(late.id, {
			type: "MSI",
			totalMonths: 12,
			monthlyAmount: new Decimal(200),
			interestRate: null,
		});
		store.addExpense(100, new Date(2026, 8, 20)); // ordinary charge in period 1
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));

		expect(store.statements).toHaveLength(1);
		expect(installmentRows(store)).toHaveLength(0);
	});

	it("adds the MSCI interest component to the debt at each cut and keeps PNGI at the mensualidad", async () => {
		const store = new FakeStore(new Decimal(0));
		const purchase = store.addExpense(6000, new Date(2026, 9, 5), null, "Phone");
		store.addPlan(purchase.id, {
			type: "MSCI",
			totalMonths: 12,
			monthlyAmount: new Decimal(560), // 500 principal + 60 interest
			interestRate: new Decimal("0.12"),
		});
		const { service } = await buildHarness(store);

		await generateAt(service, new Date(2026, 9, 16));
		const s1 = latest(store);
		// Interest component is new debt charged at the cut
		expect(store.accountBalance.toFixed(2)).toBe("6060.00");
		// Frozen balance excludes cut-time charges (same as INTEREST_CHARGE)
		expect(s1.balance.toFixed(2)).toBe("6000.00");
		expect(s1.noInterestPayment.toFixed(2)).toBe("560.00");
		const [row1] = installmentRows(store);
		expect(row1.amount.toString()).toBe("560");
		expect(row1.description).toBe("Phone (1/12)");

		store.addPayment(560, new Date(2026, 9, 20));
		s1.paidAmount = new Decimal(560);

		await generateAt(service, new Date(2026, 10, 16));
		const s2 = latest(store);
		// 6060 - 560 paid: the carried interest is now part of the opening balance
		expect(s2.balance.toFixed(2)).toBe("5500.00");
		// PNGI = 5500 - 5500 remaining principal + 560 → no double counted interest
		expect(s2.noInterestPayment.toFixed(2)).toBe("560.00");
		expect(s2.interestAmount.toFixed(2)).toBe("0.00");
		expect(store.accountBalance.toFixed(2)).toBe("5560.00");
		expect(installmentRows(store).map((r) => r.installmentNumber)).toEqual([1, 2]);
	});
});
