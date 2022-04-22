import type { Worker } from 'cluster';
import cluster from 'cluster';
import { cpus } from 'os';
import { getLoggerFor } from '../logging/LogUtil';

const workers: any[] = [];

const logger = getLoggerFor('ClusterManager');

export function setupWorkers(): void {
  const numCores = cpus().length;
  logger.info(`Master cluster setting up ${numCores} workers`);

  for (let i = 0; i < numCores; i++) {
    workers.push(cluster.fork());

    workers[i].on('message', (msg: string): void => {
      logger.info(msg);
    });
  }

  cluster.on('online', (worker: Worker): void => {
    logger.info(`Worker ${worker.process.pid} is listening`);
  });

  cluster.on('exit', (worker: Worker, code: number, signal: string): void => {
    logger.warn(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    logger.warn('Starting a new worker');
    workers.push(cluster.fork());
    workers[workers.length - 1].on('message', (msg: string): void => {
      logger.info(msg);
    });
  });
}

export async function setupApplication<T>(startApplicationFn: () => Promise<T>, isClusterMode: boolean):
Promise<T | void> {
  if (isClusterMode && cluster.isMaster) {
    return setupWorkers();
  }
  return await startApplicationFn();
}

export function spawnWorkers(isClusterMode: boolean): void {
  if (isClusterMode && cluster.isMaster) {
    return setupWorkers();
  }
}
