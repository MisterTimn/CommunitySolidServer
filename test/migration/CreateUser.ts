/* eslint-disable no-console */
import type { User } from '../../scripts/CredentialHelper';
import { CredentialHelper } from '../../scripts/CredentialHelper';

const baseUrl = `http://localhost:3000/`;

const credHelper = new CredentialHelper(baseUrl);
const alice: User = {
  email: 'alice@example.com',
  password: 'alice-secret',
  podName: 'alice',
};

credHelper.register(alice)
  .then((): any => {
    console.log('registered');
  })
  .catch((err): void => {
    console.error(err);
  });

