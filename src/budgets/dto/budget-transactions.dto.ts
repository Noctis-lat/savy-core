import { QueryAccountTransactionsDto } from "../../accounts/dto/account-transactions.dto";

/**
 * Same query contract as `GET /accounts/:id/transactions`.
 * When `from`/`to` are omitted the budget's current period bounds are used.
 * A `categoryId` outside the budget's items returns an empty page.
 */
export class QueryBudgetTransactionsDto extends QueryAccountTransactionsDto {}
