import React, { useState } from 'react';
import { Field } from '../components/Primitives.jsx';
import { ErrorState } from '../components/States.jsx';
import { useLogin } from '../lib/queries.js';

export default function Login({ authStatus }) {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const notConfigured = authStatus?.authConfigured === false;

  const onSubmit = (event) => {
    event.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1>Nexus</h1>
        <p className="muted">Second brain and business operations command center.</p>

        {notConfigured ? (
          <div className="state state-error" role="alert">
            <h3>Owner sign-in is not configured</h3>
            <p>
              Set <code>OWNER_EMAIL</code> and <code>OWNER_PASSWORD_HASH</code> in the server environment, then
              restart the API. Generate a hash with <code>npm run auth:hash</code>.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <Field label="Email" required>
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password" required>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {login.isError && <ErrorState error={login.error} compact />}

            <button type="submit" className="button button-primary" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
