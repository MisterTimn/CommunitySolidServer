import { getLoggerFor } from '../logging/LogUtil';
import { InternalServerError } from './errors/InternalServerError';

const logger = getLoggerFor('LockUtil');

/**
 * Await this function to wait a set amount of time (without consuming cpu).
 * @param delay - How long to wait.
 * @param jitter - A fraction of this jitter will be added to the delay.
 * @returns Promise<void> when ready.
 */
export async function setJitterTimeout(delay: number, jitter = 0): Promise<void> {
  function calcTime(): number {
    jitter = jitter > 0 ? Math.max(1, Math.floor(Math.random() * jitter)) : 0;
    return Math.max(0, delay + jitter);
  }
  return new Promise<void>((resolve): any => setTimeout(resolve, calcTime()));
}

export interface AttemptSettings {
  /** How many times should an operation be retried. (-1 is indefinitely). */
  retryCount?: number;
  /** The how long should the next retry be delayed (+ some retryJitter) (in ms). */
  retryDelay?: number;
  /** Add a fraction of jitter to the original delay each attempt (in ms). */
  retryJitter?: number;
}

export interface LockRequestState<T> {
  /** Should the function be retried. This means retrying might change the outcome. */
  shouldRetry: boolean;
  /** If shouldRetry is true, than a response might me present */
  response?: T;
  /** An error might be present, no matter if shouldRetry is true or false. */
  error?: Error;
}

/**
 * Will execute the given function until one of the following 3 cases occurs:
 * * The function resolves: the resolved Promise is returned.
 * * The function errors: the rejected error is returned.
 * * The function did not resolve after the set amount of retries:
 *   the rejected error is returned.
 * @param fn - The function to retry. You can wrap the function with {@link toRetryOnBoolean}
 *              or {@link toRetryOnError} to customize when-to-retry behaviour
 * @param settings - The options on how to retry the function
 */
export async function retryFunctionUntil<T>(fn: () => Promise<LockRequestState<T>>,
  settings: Required<AttemptSettings>): Promise<T | void> {
  const { retryCount, retryDelay, retryJitter } = settings;
  const maxTries = retryCount === -1 ? Number.POSITIVE_INFINITY : retryCount + 1;
  let tries = 1;
  let state: LockRequestState<T> = { shouldRetry: true };

  // Keep going until function resolves or maxTries has been reached.
  while (state.shouldRetry && tries <= maxTries) {
    state = await fn();
    if (state.shouldRetry) {
      await setJitterTimeout(retryDelay, retryJitter);
      tries += 1;
    } else if (state.error) {
      throw state.error;
    } else if (state.response) {
      return state.response;
    }
  }

  // Max tries was reached
  if (tries > maxTries) {
    const err = `The operation did not succeed after the set maximum of tries (${maxTries}).`;
    logger.warn(err);
    throw new InternalServerError(err);
  }
}

/**
 * Wraps a function to prepare for retrying on error.
 * e.g. If the lock is held and can't be acquired the library rejects with an error.
 * @param stopCondition - A function taking the error that occured, outputs true if it has to stop retrying.
 * @param fn - Library function to call
 * @returns An object indicating whether is thould be retried or not.
 */
export function toRetryOnError<T>(stopCondition: (err: any) => boolean, fn: () => Promise<T>):
() => Promise<LockRequestState<T>> {
  return (): Promise<LockRequestState<T>> => fn()
    .then((response): LockRequestState<T> => ({ shouldRetry: false, response }))
    .catch((err): LockRequestState<T> => ({ shouldRetry: !stopCondition(err), error: err }));
}

/**
 * Wraps a function to prepare for retrying on a given boolean value.
 * e.g. If the lock is held and can't be acquired the library resolves with false.
 * @param fn - Library function to call
 * @throws On internal error.
 * @returns An object indicating whether is thould be retried or not.
 */
export function toRetryOnBoolean(retryValue: boolean, fn: () => Promise<any>):
() => Promise<LockRequestState<boolean>> {
  return (): Promise<LockRequestState<boolean>> => fn()
    .then((response): LockRequestState<boolean> => ({ shouldRetry: response === retryValue, response }))
    .catch((err): LockRequestState<boolean> => ({ shouldRetry: false, error: err }));
}
