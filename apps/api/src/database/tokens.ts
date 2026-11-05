/**
 * Injection tokens live in a leaf file with no imports of their own.
 *
 * `DatabaseModule` declares `UnitOfWork`, and `UnitOfWork` injects the pool. If
 * the token were exported from the module file, those two files would form an
 * import cycle and the token would still be `undefined` when the `@Inject`
 * decorator was evaluated, which Nest reports as a circular dependency.
 */
export const APP_POOL = 'APP_POOL';
