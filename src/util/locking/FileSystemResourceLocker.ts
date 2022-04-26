import { createHash } from 'crypto';
import { ensureDirSync, pathExists, readdir, rmdir } from 'fs-extra';
import type { LockOptions, UnlockOptions } from 'proper-lockfile';
import { lock, unlock } from 'proper-lockfile';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import type { Finalizable } from '../../init/final/Finalizable';
import { getLoggerFor } from '../../logging/LogUtil';
import { createErrorMessage } from '../errors/ErrorUtil';
import { InternalServerError } from '../errors/InternalServerError';
import type { AttemptSettings } from '../LockUtils';
import { toRetryOnError, retryFunctionUntil } from '../LockUtils';
import { joinFilePath } from '../PathUtil';
import type { ResourceLocker } from './ResourceLocker';

const defaultLockOptions: LockOptions = {
  /** Resolve symlinks using realpath, defaults to true (note that if true, the file must exist previously) */
  realpath: false,
  /** The number of retries or a [retry](https://www.npmjs.org/package/retry) options object, defaults to 0 */
  retries: 0,
};

const defaultUnlockOptions: UnlockOptions = {
  /** Resolve symlinks using realpath, defaults to true (note that if true, the file must exist previously) */
  realpath: false,
};

const attemptDefaults: Required<AttemptSettings> = { retryCount: -1, retryDelay: 50, retryJitter: 30 };

/**
 * Argument interface of the FileSystemResourceLocker constructor.
 */
interface FileSystemResourceLockerArgs {
  /** The rootPath of the filesystem */
  rootFilePath?: string;
  /** The path to the directory where locks will be stored (appended to rootFilePath) */
  lockDirectory?: string;
  /** Custom settings concerning retrying locks */
  attemptSettings?: AttemptSettings;
}

function isCodedError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * A resource locker making use of the [proper-lockfile](https://www.npmjs.com/package/proper-lockfile) library.
 * Note that no locks are kept in memory, thus this is considered thread- and process-safe.
 *
 * This **proper-lockfile** library has its own retry mechanism for the operations, since a lock/unlock call will
 * either resolve successfully or reject immediatly with the causing error. The retry function of the library
 * however will be ignored and replaced by our own LockUtils' {@link retryFunctionUntil} function.
 *
 * This allows us to reuse the AttemptSettings semantics similar to the {@link RedisLocker} class.
 */
export class FileSystemResourceLocker implements ResourceLocker, Finalizable {
  protected readonly logger = getLoggerFor(this);
  private readonly attemptSettings: Required<AttemptSettings>;
  /** Folder that stores the locks */
  private readonly lockFolder: string;

  /**
   * Create a new FileSystemResourceLocker
   * @param rootFilePath - The rootPath of the filesystem
   * @param lockDirectory - The path to the directory where locks will be stored (appended to rootFilePath)
                            _[default is `/.internal/locks`]_
   * @param attemptSettings - Custom settings concerning retrying locks
   */
  public constructor(args: FileSystemResourceLockerArgs = {}) {
    const { rootFilePath, lockDirectory, attemptSettings } = args;
    this.attemptSettings = { ...attemptDefaults, ...attemptSettings };
    this.lockFolder = joinFilePath(rootFilePath ?? './', lockDirectory ?? '/.internal/locks');
    ensureDirSync(this.lockFolder);
  }

  /** Stop retry when this error occurs */
  private readonly stopOnError = (err: any): boolean => isCodedError(err) && err.code === 'ENOTACQUIRED';

  /**
   * Utility wrapper function for all un/lock operations. The function reference will
   * be retried with the current {@link AttemptSettings} until the function resolves
   * or the {@link stopOnError} condition holds.
   * @param fn - The function reference to retry until successful or stopped.
   */
  private async retryUntilError<T>(fn: () => Promise<any>): Promise<T> {
    return await retryFunctionUntil<any>(toRetryOnError(this.stopOnError, fn), this.attemptSettings);
  }

  public async acquire(identifier: ResourceIdentifier): Promise<void> {
    const { path } = identifier;
    this.logger.debug(`Acquiring lock for ${path}`);
    try {
      const opt = this.generateOptions(identifier, defaultLockOptions);
      await this.retryUntilError((): any => lock(path, opt));
    } catch (err: unknown) {
      throw new InternalServerError(`Error trying to acquire lock for ${path}. ${createErrorMessage(err)}`);
    }
  }

  public async release(identifier: ResourceIdentifier): Promise<void> {
    const { path } = identifier;
    this.logger.debug(`Releasing lock for ${path}`);

    try {
      const opt = this.generateOptions(identifier, defaultUnlockOptions);
      await this.retryUntilError((): any => unlock(path, opt));
    } catch (err: unknown) {
      throw new InternalServerError(`Error trying to release lock for ${path}.  ${createErrorMessage(err)}`);
    }
  }

  /**
   * Map the identifier path to a unique path inside the {@link lockFolder}.
   * @param identifier - ResourceIdentifier to generate (Un)LockOptions for.
   * @returns Full path.
   */
  private toLockfilePath(identifier: ResourceIdentifier): string {
    const hash = createHash('md5');
    const { path } = identifier;
    return joinFilePath(this.lockFolder, hash.update(path).digest('hex'));
  }

  /**
 * Generate LockOptions or UnlockOptions depending on the type of defauls given.
 * A custom lockFilePath mapping strategy will be used.
 * @param identifier - ResourceIdentifier to generate (Un)LockOptions for
 * @param defaults - The default options. (lockFilePath will get overwritten)
 * @returns LockOptions or UnlockOptions
 */
  private generateOptions<T>(identifier: ResourceIdentifier, defaults: T): T {
    const lockfilePath = this.toLockfilePath(identifier);
    return {
      ...defaults,
      lockfilePath,
    };
  }

  public async finalize(): Promise<void> {
    // Delete lingering locks in the lockFolder.
    if (await pathExists(this.lockFolder)) {
      for (const dir of await readdir(this.lockFolder)) {
        await rmdir(`${this.lockFolder}/${dir}`);
      }
      await rmdir(this.lockFolder);
    }
  }
}
