import fetch from 'cross-fetch';
import urljoin from 'url-join';

export type User = {
  email: string;
  password: string;
  podName: string;
};

export class CredentialHelper {
  private readonly baseUrl: string;

  public constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Registers a user with the server.
   * @param user - The user settings necessary to register a user.
   */
  public async register(user: User): Promise<void> {
    const body = JSON.stringify({
      ...user,
      confirmPassword: user.password,
      createWebId: true,
      register: true,
      createPod: true,
    });
    const res = await fetch(urljoin(this.baseUrl, '/idp/register/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (res.status !== 200) {
      throw new Error(`Registration failed: ${await res.text()}`);
    }
  }

  /**
   * Requests a client credentials API token.
   * @param user - User for which the token needs to be generated.
   * @returns The id/secret for the client credentials request.
   */
  public async createCredentials(user: User): Promise<{ id: string; secret: string }> {
    const res = await fetch(urljoin(this.baseUrl, '/idp/credentials/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password, name: 'token' }),
    });
    if (res.status !== 200) {
      throw new Error(`Token generation failed: ${await res.text()}`);
    }

    return res.json();
  }
}
