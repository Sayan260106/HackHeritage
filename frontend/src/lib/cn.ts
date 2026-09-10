/** Joins class names, dropping anything falsy. Keeps JSX readable without
 *  pulling in clsx for what amounts to four lines. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
