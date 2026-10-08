import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PROFILE_ID = "46aa4674-0f78-4415-a82d-fed095a73e0d";

// ─── Date helpers ──────────────────────────────────────────────────────
const now = new Date();
const currentYear = now.getUTCFullYear();
const currentMonth = now.getUTCMonth(); // 0-indexed

function dateInMonth(year: number, month: number, day: number): Date {
	return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

function previousMonthRef(): { year: number; month: number } {
	if (currentMonth === 0) return { year: currentYear - 1, month: 11 };
	return { year: currentYear, month: currentMonth - 1 };
}

const prev = previousMonthRef();
const cur = (day: number) => dateInMonth(currentYear, currentMonth, day);
const old = (day: number) => dateInMonth(prev.year, prev.month, day);

// ─── Category definitions ──────────────────────────────────────────────
const incomeCategories = ["Salario", "Freelance", "Inversiones"];
const expenseCategories = [
	"Renta",
	"Comida",
	"Transporte",
	"Servicios",
	"Entretenimiento",
	"Salud",
	"Educación",
	"Ropa",
];

type CategoryMap = Record<string, string>;

async function createCategories(): Promise<{
	income: CategoryMap;
	expense: CategoryMap;
}> {
	const income: CategoryMap = {};
	const expense: CategoryMap = {};

	for (const name of incomeCategories) {
		const c = await prisma.category.create({
			data: { profileId: PROFILE_ID, name, type: "INCOME" },
		});
		income[name] = c.id;
	}

	for (const name of expenseCategories) {
		const c = await prisma.category.create({
			data: { profileId: PROFILE_ID, name, type: "EXPENSE" },
		});
		expense[name] = c.id;
	}

	return { income, expense };
}

async function main() {
	// ─── Cleanup: delete banks (cascade → accounts → creditCards/loans/transactions) ───
	console.log("Cleaning existing data for profile...");
	await prisma.savingsGoal.deleteMany({ where: { profileId: PROFILE_ID } });
	await prisma.budget.deleteMany({ where: { profileId: PROFILE_ID } });
	await prisma.bank.deleteMany({ where: { profileId: PROFILE_ID } });
	await prisma.category.deleteMany({ where: { profileId: PROFILE_ID } });
	console.log("Cleaned savings goals, budgets, banks, and categories.");

	// ─── 1. Categories ────────────────────────────────────────────────────
	const { income, expense } = await createCategories();
	console.log(`Created ${incomeCategories.length + expenseCategories.length} categories.`);

	// ─── 2. Banks ─────────────────────────────────────────────────────────
	const bbva = await prisma.bank.create({
		data: {
			profileId: PROFILE_ID,
			name: "BBVA",
			color: "#0047A0",
			logo: "bbva",
			isActive: true,
		},
	});
	const santander = await prisma.bank.create({
		data: {
			profileId: PROFILE_ID,
			name: "Santander",
			color: "#EC0000",
			logo: "santander",
			isActive: true,
		},
	});
	const nu = await prisma.bank.create({
		data: {
			profileId: PROFILE_ID,
			name: "Nu",
			color: "#8B5CF6",
			logo: "nu",
			isActive: true,
		},
	});
	console.log("Created 3 banks.");

	// ─── 3. Accounts ──────────────────────────────────────────────────────
	// Bank 1 — BBVA
	const acc1 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: bbva.id,
			name: "Cuenta Nomina",
			type: "DEBIT",
			balance: 45000.0,
			currency: "MXN",
			isActive: true,
		},
	});
	const acc2 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: bbva.id,
			name: "Cuenta Ahorro",
			type: "DEBIT",
			balance: 120000.0,
			currency: "MXN",
			isActive: true,
		},
	});
	const acc3 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: bbva.id,
			name: "Efectivo",
			type: "CASH",
			balance: 3500.0,
			currency: "MXN",
			isActive: true,
		},
	});
	const acc4 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: bbva.id,
			name: "Tarjeta Credito Oro",
			type: "CREDIT",
			balance: 8500.0,
			currency: "MXN",
			isActive: true,
		},
	});
	const acc5 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: bbva.id,
			name: "Préstamo Personal",
			type: "LOAN",
			balance: 0,
			currency: "MXN",
			isActive: true,
		},
	});

	// Bank 2 — Santander
	const acc6 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: santander.id,
			name: "Cuenta Principal",
			type: "DEBIT",
			balance: 23000.0,
			currency: "MXN",
			isActive: true,
		},
	});
	const acc7 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: santander.id,
			name: "Tarjeta Credito",
			type: "CREDIT",
			balance: 3200.0,
			currency: "MXN",
			isActive: true,
		},
	});

	// Bank 3 — Nu
	const acc8 = await prisma.account.create({
		data: {
			profileId: PROFILE_ID,
			bankId: nu.id,
			name: "Cuenta Nu",
			type: "DEBIT",
			balance: 8000.0,
			currency: "MXN",
			isActive: true,
		},
	});
	console.log("Created 8 accounts.");

	// ─── 4. CreditCards ───────────────────────────────────────────────────
	await prisma.creditCard.create({
		data: {
			accountId: acc4.id,
			creditLimit: 50000.0,
			cutDay: 15,
			paymentDay: 25,
			interestRate: 0.36,
			noInterestMonths: 12,
		},
	});
	await prisma.creditCard.create({
		data: {
			accountId: acc7.id,
			creditLimit: 30000.0,
			cutDay: 5,
			paymentDay: 15,
			interestRate: 0.42,
			noInterestMonths: 6,
		},
	});
	console.log("Created 2 credit cards.");

	// ─── 5. Loans ─────────────────────────────────────────────────────────
	await prisma.loan.create({
		data: {
			accountId: acc5.id,
			principal: 150000.0,
			interestRate: 0.165,
			termMonths: 36,
			startDate: dateInMonth(2024, 0, 15),
			monthlyPayment: 5300.0,
			remaining: 95000.0,
		},
	});
	console.log("Created 1 loan.");

	// ─── 6. Transactions ──────────────────────────────────────────────────
	type TxSeed = {
		accountId: string;
		type: "INCOME" | "EXPENSE";
		amount: number;
		categoryId?: string;
		date: Date;
		description: string;
	};

	const txns: TxSeed[] = [
		// Account 1 — Cuenta Nómina (current month)
		{
			accountId: acc1.id,
			type: "INCOME",
			amount: 35000.0,
			categoryId: income["Salario"],
			date: cur(1),
			description: "Salario mensual",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 12000.0,
			categoryId: expense["Renta"],
			date: cur(2),
			description: "Renta departamento",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 4500.0,
			categoryId: expense["Comida"],
			date: cur(3),
			description: "Súper de la semana",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 1200.0,
			categoryId: expense["Transporte"],
			date: cur(4),
			description: "Gasolina",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 800.0,
			categoryId: expense["Transporte"],
			date: cur(5),
			description: "Uber",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 2500.0,
			categoryId: expense["Servicios"],
			date: cur(6),
			description: "Luz y agua",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 1500.0,
			categoryId: expense["Entretenimiento"],
			date: cur(8),
			description: "Cine y cena",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 3200.0,
			categoryId: expense["Comida"],
			date: cur(10),
			description: "Súper segunda semana",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 950.0,
			categoryId: expense["Salud"],
			date: cur(12),
			description: "Farmacia",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 1800.0,
			categoryId: expense["Ropa"],
			date: cur(15),
			description: "Ropa nueva",
		},

		// Account 2 — Cuenta Ahorro (current month)
		{
			accountId: acc2.id,
			type: "INCOME",
			amount: 8000.0,
			categoryId: income["Freelance"],
			date: cur(5),
			description: "Proyecto freelance",
		},
		{
			accountId: acc2.id,
			type: "INCOME",
			amount: 2500.0,
			categoryId: income["Inversiones"],
			date: cur(10),
			description: "Dividendos",
		},
		{
			accountId: acc2.id,
			type: "EXPENSE",
			amount: 3000.0,
			categoryId: expense["Educación"],
			date: cur(7),
			description: "Curso online",
		},
		{
			accountId: acc2.id,
			type: "EXPENSE",
			amount: 2200.0,
			categoryId: expense["Comida"],
			date: cur(14),
			description: "Súper tercera semana",
		},
		{
			accountId: acc2.id,
			type: "EXPENSE",
			amount: 600.0,
			categoryId: expense["Entretenimiento"],
			date: cur(16),
			description: "Suscripciones streaming",
		},

		// Account 3 — Efectivo (current month)
		{
			accountId: acc3.id,
			type: "EXPENSE",
			amount: 500.0,
			categoryId: expense["Comida"],
			date: cur(9),
			description: "Comida callejera",
		},
		{
			accountId: acc3.id,
			type: "EXPENSE",
			amount: 300.0,
			categoryId: expense["Transporte"],
			date: cur(11),
			description: "Taxi",
		},
		{
			accountId: acc3.id,
			type: "EXPENSE",
			amount: 150.0,
			categoryId: expense["Entretenimiento"],
			date: cur(13),
			description: "Café",
		},

		// Account 4 — Tarjeta Credito Oro (current month)
		{
			accountId: acc4.id,
			type: "EXPENSE",
			amount: 1500.0,
			categoryId: expense["Ropa"],
			date: cur(14),
			description: "Compra online",
		},
		{
			accountId: acc4.id,
			type: "EXPENSE",
			amount: 800.0,
			categoryId: expense["Servicios"],
			date: cur(16),
			description: "Suscripción",
		},

		// Account 1 — previous month
		{
			accountId: acc1.id,
			type: "INCOME",
			amount: 35000.0,
			categoryId: income["Salario"],
			date: old(1),
			description: "Salario mes anterior",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 12000.0,
			categoryId: expense["Renta"],
			date: old(2),
			description: "Renta mes anterior",
		},
		{
			accountId: acc1.id,
			type: "EXPENSE",
			amount: 3800.0,
			categoryId: expense["Comida"],
			date: old(5),
			description: "Súper mes anterior",
		},

		// Account 2 — previous month
		{
			accountId: acc2.id,
			type: "INCOME",
			amount: 5000.0,
			categoryId: income["Freelance"],
			date: old(10),
			description: "Freelance mes anterior",
		},
		{
			accountId: acc2.id,
			type: "EXPENSE",
			amount: 2800.0,
			categoryId: expense["Comida"],
			date: old(12),
			description: "Súper mes anterior",
		},
	];

	for (const t of txns) {
		await prisma.transaction.create({
			data: {
				accountId: t.accountId,
				type: t.type,
				amount: t.amount,
				categoryId: t.categoryId ?? null,
				date: t.date,
				description: t.description,
			},
		});
	}
	console.log(`Created ${txns.length} transactions.`);

	// ─── 7. Budgets ───────────────────────────────────────────────────────
	const monthStart = dateInMonth(currentYear, currentMonth, 1);
	const budgetDefs = [
		{ name: "Comida", amount: 12000.0 },
		{ name: "Transporte", amount: 4000.0 },
		{ name: "Servicios", amount: 5000.0 },
		{ name: "Entretenimiento", amount: 3000.0 },
		{ name: "Renta", amount: 12000.0 },
		{ name: "Ropa", amount: 2500.0 },
	];
	for (const b of budgetDefs) {
		await prisma.budget.create({
			data: {
				profileId: PROFILE_ID,
				categoryId: expense[b.name],
				amount: b.amount,
				period: "MONTHLY",
				startDate: monthStart,
				isActive: true,
			},
		});
	}
	console.log(`Created ${budgetDefs.length} budgets.`);

	// ─── 8. SavingsGoals ─────────────────────────────────────────────────
	function monthsFromNow(months: number): Date {
		const d = new Date(Date.UTC(currentYear, currentMonth + months, 1, 12, 0, 0, 0));
		return d;
	}
	const goalDefs = [
		{
			name: "Fondo de Emergencia",
			accountId: acc2.id,
			targetAmount: 200000.0,
			deadline: monthsFromNow(6),
			color: "#10B981",
		},
		{
			name: "Viaje a Europa",
			accountId: acc2.id,
			targetAmount: 150000.0,
			deadline: monthsFromNow(12),
			color: "#3B82F6",
		},
		{
			name: "MacBook Pro",
			accountId: acc1.id,
			targetAmount: 65000.0,
			deadline: monthsFromNow(4),
			color: "#8B5CF6",
		},
		{
			name: "Boda",
			accountId: acc2.id,
			targetAmount: 300000.0,
			deadline: monthsFromNow(18),
			color: "#EC4899",
		},
	];
	for (const g of goalDefs) {
		await prisma.savingsGoal.create({
			data: {
				profileId: PROFILE_ID,
				accountId: g.accountId,
				name: g.name,
				targetAmount: g.targetAmount,
				deadline: g.deadline,
				color: g.color,
			},
		});
	}
	console.log(`Created ${goalDefs.length} savings goals.`);

	// ─── Summary ──────────────────────────────────────────────────────────
	console.log("\n=== Seed complete ===");
	console.log(`Profile: ${PROFILE_ID}`);
	console.log(`Banks: 3 (BBVA=${bbva.id}, Santander=${santander.id}, Nu=${nu.id})`);
	console.log(`Accounts: 8 (BBVA=5, Santander=2, Nu=1)`);
	console.log(`Credit cards: 2`);
	console.log(`Loans: 1`);
	console.log(
		`Categories: ${incomeCategories.length + expenseCategories.length} (income=${incomeCategories.length}, expense=${expenseCategories.length})`,
	);
	console.log(`Transactions: ${txns.length}`);
	console.log(`Budgets: ${budgetDefs.length}`);
	console.log(`Savings goals: ${goalDefs.length}`);
	console.log(`\nMain test bank (BBVA) ID: ${bbva.id}`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
		await pool.end();
	});
