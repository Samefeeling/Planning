/**
 * Branded identifier types.
 *
 * These are structurally `string` at runtime but nominally distinct at
 * compile time, so you cannot accidentally pass a `PartId` where a
 * `MachineId` is expected. Construct them through the helper functions,
 * which also normalise casing/whitespace so look-ups are stable.
 */

declare const __brand: unique symbol;
type Brand<K, B> = K & { readonly [__brand]: B };

export type MachineId = Brand<string, 'MachineId'>;
export type ToolId = Brand<string, 'ToolId'>; // a die / mould
export type InsertId = Brand<string, 'InsertId'>; // a die insert / cavity set
export type PartId = Brand<string, 'PartId'>; // finished good or raw material BNO
export type JobId = Brand<string, 'JobId'>; // Epicor JobHead_JobNum
export type ColorId = Brand<string, 'ColorId'>;

const norm = (s: string): string => s.trim();

/** Machine ids are matched case-insensitively (`1300t` === `1300T`). */
export const MachineId = (s: string): MachineId =>
  norm(s).toUpperCase() as MachineId;

/** Die / tool names are free text; compare case-insensitively. */
export const ToolId = (s: string): ToolId => norm(s).toLowerCase() as ToolId;

export const InsertId = (s: string): InsertId =>
  norm(s).toLowerCase() as InsertId;

export const PartId = (s: string): PartId => norm(s) as PartId;

export const JobId = (s: string): JobId => norm(s) as JobId;

export const ColorId = (s: string): ColorId =>
  norm(s).toLowerCase() as ColorId;

/** Read the raw string back out of any branded id. */
export const idValue = (id: { toString(): string }): string => String(id);
