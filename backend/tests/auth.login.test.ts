import { AuthResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { TEST_PASSWORD, api, signUp, uniqueEmail } from './support/api.ts';

describe('POST /v1/auth/login', () => {
  it('exchanges email and password for a session', async () => {
    const email = uniqueEmail();
    const account = await signUp({ email });

    const response = await api().post('/v1/auth/login').send({ email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(() => AuthResponse.parse(response.body)).not.toThrow();
    expect(response.body.user.id).toBe(account.user.id);
  });

  it('issues a different refresh token than signup did', async () => {
    const email = uniqueEmail();
    const account = await signUp({ email });

    const response = await api().post('/v1/auth/login').send({ email, password: TEST_PASSWORD });

    // Sessions are per-login, so logging in on a second device must not hand out the
    // first device's token — revoking one would otherwise log both out.
    expect(response.body.refreshToken).not.toBe(account.refreshToken);
  });

  it('rejects a wrong password', async () => {
    const email = uniqueEmail();
    await signUp({ email });

    const response = await api()
      .post('/v1/auth/login')
      .send({ email, password: 'not-the-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('invalid_credentials');
  });

  it('reports an unknown email identically to a wrong password', async () => {
    const email = uniqueEmail();
    await signUp({ email });

    const wrongPassword = await api()
      .post('/v1/auth/login')
      .send({ email, password: 'not-the-password' });
    const unknownEmail = await api()
      .post('/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: TEST_PASSWORD });

    // Byte-identical, or the endpoint becomes an account-enumeration oracle: "does this
    // person have an account here" is not a question it should answer.
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('accepts the email in any case', async () => {
    const email = uniqueEmail();
    await signUp({ email });

    const response = await api()
      .post('/v1/auth/login')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
  });

  it('tolerates surrounding whitespace in the email', async () => {
    const email = uniqueEmail();
    await signUp({ email });

    const response = await api()
      .post('/v1/auth/login')
      .send({ email: `  ${email}  `, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
  });

  it('does not trim the password', async () => {
    const email = uniqueEmail();
    await signUp({ email });

    // Whitespace is a legitimate part of a passphrase. Trimming it silently would mean
    // a password the user can type but not re-type.
    const response = await api()
      .post('/v1/auth/login')
      .send({ email, password: ` ${TEST_PASSWORD} ` });

    expect(response.status).toBe(401);
  });

  it('rejects a login missing a field', async () => {
    const response = await api().post('/v1/auth/login').send({ email: uniqueEmail() });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('rejects unknown fields', async () => {
    const response = await api()
      .post('/v1/auth/login')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, userId: 'someone-else' });

    // Specifically important here: no endpoint in this API accepts a client-supplied
    // `userId`, and a strict schema is what makes that structural rather than a habit.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});
