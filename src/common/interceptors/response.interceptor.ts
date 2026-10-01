import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface ApiResponse<T> {
	success: boolean;
	data: T;
	message?: string;
}

/**
 * Detect Prisma Decimal (decimal.js) instances.
 * They have a `d` property (digits array) and `toFixed`/`toNumber` methods.
 */
function isDecimal(value: unknown): value is { toNumber(): number } {
	return (
		value !== null &&
		typeof value === "object" &&
		"d" in (value as Record<string, unknown>) &&
		"toNumber" in (value as Record<string, unknown>) &&
		typeof (value as { toNumber: unknown }).toNumber === "function"
	);
}

/**
 * Recursively convert all Prisma Decimal values to numbers.
 * Handles nested objects, arrays, and Date instances (left untouched).
 */
function serializeDecimals<T>(data: T): T {
	if (data === null || data === undefined) return data;
	if (isDecimal(data)) return data.toNumber() as T;
	if (data instanceof Date) return data;
	if (Array.isArray(data)) return data.map(serializeDecimals) as T;
	if (typeof data === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			result[key] = serializeDecimals(value);
		}
		return result as T;
	}
	return data;
}

/**
 * Global response interceptor — wraps ALL successful responses in a standard envelope
 * and converts Prisma Decimal fields to numbers.
 *
 * Before: controller returns `{ id, name, balance: Decimal("1200000") }`
 * After:  client receives `{ success: true, data: { id, name, balance: 1200000 } }`
 *
 * If the controller already returns `{ message: "..." }` (e.g. logout, delete),
 * the message is extracted and the remaining data is placed in `data`.
 *
 * Exception responses are handled by HttpExceptionFilter, not this interceptor.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
	intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
		return next.handle().pipe(
			map((responseData) => {
				const serialized = serializeDecimals(responseData);

				// If the controller returned an object with only a `message` field,
				// treat it as a message-only response (e.g. { message: "Logged out" })
				if (
					serialized &&
					typeof serialized === "object" &&
					"message" in serialized &&
					Object.keys(serialized).length === 1
				) {
					return {
						success: true,
						data: null as T,
						message: (serialized as Record<string, unknown>).message as string,
					};
				}

				return {
					success: true,
					data: serialized,
				};
			}),
		);
	}
}
