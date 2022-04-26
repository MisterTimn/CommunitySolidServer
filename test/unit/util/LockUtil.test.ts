import { setJitterTimeout } from '../../../src/util/LockUtils';

jest.useFakeTimers();

describe('LockUtil', (): void => {
  describe('#setJitterTimout', (): void => {
    it('works without jitter.', async(): Promise<void> => {
      let result = '';
      const promise = setJitterTimeout(1000).then((): void => {
        result += 'ok';
      });
      expect(result).toHaveLength(0);
      jest.advanceTimersByTime(1000);
      await expect(promise).resolves.toBeUndefined();
      expect(result).toBe('ok');
    });

    it('works with jitter.', async(): Promise<void> => {
      let start = Date.now();
      const promise = setJitterTimeout(1000, 100).then((): void => {
        start = Date.now() - start;
      });
      jest.advanceTimersByTime(1100);
      await expect(promise).resolves.toBeUndefined();
      expect(start).toBeGreaterThan(0);
    });
  });
});
