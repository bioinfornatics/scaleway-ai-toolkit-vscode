/** Official CLI browser flow, without its API-key creation step. No password capture. */

import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import { ReadError, uuid, validateJWT } from './provider';
export interface UserSession {
  token: string;
  expiresAt: number;
  userId: string;
}
export function parseSession(encoded: string, now = Date.now()): UserSession {
  try {
    if (
      encoded.length > 32768 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    )
      throw 0;
    const raw = Buffer.from(encoded, 'base64');
    if (!raw.length || raw.toString('base64') !== encoded) throw 0;
    const body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(raw),
    );
    if (!validateJWT(body.token) || !uuid(body.jwt?.audienceId)) throw 0;
    const claims = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(body.token.split('.')[1], 'base64url'),
      ),
    );
    const metadataExpiry = Date.parse(body.jwt.expiresAt);
    if (!Number.isSafeInteger(claims.exp) || !Number.isFinite(metadataExpiry))
      throw 0;
    const expiresAt = Math.min(claims.exp * 1000, metadataExpiry);
    if (expiresAt <= now + 30000) throw new ReadError('session_expired');
    // Only shape/expiry checks here; the Scaleway API validates authenticity and permissions.
    // renewToken and personal browser metadata are deliberately discarded.
    return { token: body.token, expiresAt, userId: body.jwt.audienceId };
  } catch (error) {
    throw error instanceof ReadError
      ? error
      : new ReadError('invalid_callback');
  }
}
export function browserLogin(
  open: (url: string) => Promise<boolean>,
  signal: AbortSignal,
  timeoutMs = 180000,
): Promise<UserSession> {
  if (signal.aborted) return Promise.reject(new ReadError('cancelled'));
  return new Promise((resolve, reject) => {
    const route = `/${randomBytes(24).toString('hex')}/callback`;
    let host = '';
    let done = false;
    let claimed = false;
    const finish = (error?: ReadError, session?: UserSession) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else if (session) resolve(session);
      else reject(new ReadError('invalid_callback'));
    };
    const cancel = () => finish(new ReadError('cancelled'));
    const server = http.createServer(
      { maxHeaderSize: 49152, requestTimeout: 5000, headersTimeout: 5000 },
      (req, res) => {
        const reply = (status: number, text: string) => {
          res.writeHead(status, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            Connection: 'close',
          });
          res.end(text);
        };
        if (done || claimed) {
          reply(409, 'Callback already consumed.');
          return;
        }
        if (
          req.method !== 'GET' ||
          req.socket.remoteAddress !== '127.0.0.1' ||
          req.headers.host !== host ||
          req.headers.origin ||
          req.headers['transfer-encoding'] ||
          req.headers['content-length']
        ) {
          reply(400, 'Invalid callback request.');
          return;
        }
        const raw = req.url ?? '';
        if (raw.length > 40000 || !raw.startsWith(`${route}?`)) {
          reply(404, 'Not found.');
          return;
        }
        let url: URL;
        try {
          url = new URL(raw, `http://${host}`);
        } catch {
          reply(400, 'Invalid callback.');
          return;
        }
        if (
          url.pathname !== route ||
          url.hash ||
          url.searchParams.size !== 1 ||
          url.searchParams.getAll('token').length !== 1
        ) {
          reply(400, 'Invalid callback.');
          return;
        }
        let session: UserSession;
        try {
          const token = url.searchParams.get('token');
          if (token === null) throw new ReadError('invalid_callback');
          session = parseSession(token);
        } catch {
          reply(400, 'Invalid or expired callback. Retry login in VS Code.');
          return;
        }
        claimed = true;
        const nonce = randomBytes(16).toString('hex');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          Connection: 'close',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'nonce-" +
            nonce +
            "'; base-uri 'none'; frame-ancestors 'none'",
        });
        res.once('finish', () => finish(undefined, session));
        res.end(
          '<!doctype html><meta charset="utf-8"><title>Scaleway — VS Code</title><script nonce="' +
            nonce +
            '">history.replaceState(null,"","/complete");</script><p>Connexion transmise à VS Code. Vous pouvez fermer cet onglet.</p>',
        );
      },
    );
    const timer = setTimeout(
      () => finish(new ReadError('login_timeout')),
      timeoutMs,
    );
    server.on('error', () => finish(new ReadError('callback_unavailable')));
    signal.addEventListener('abort', cancel, { once: true });
    server.listen(0, '127.0.0.1', () => {
      if (done) {
        server.close();
        return;
      }
      const address = server.address();
      if (!address || typeof address === 'string')
        return finish(new ReadError('callback_unavailable'));
      host = `localhost:${address.port}`;
      const url = new URL('https://account.scaleway.com/authenticate');
      // Correlation is part of redirectToUrl itself, not invented OAuth state/PKCE parameters.
      url.searchParams.set('redirectToUrl', `http://${host}${route}`);
      void open(url.toString()).then(
        (opened) => {
          if (!opened) finish(new ReadError('browser_unavailable'));
        },
        () => finish(new ReadError('browser_unavailable')),
      );
    });
    if (signal.aborted) cancel();
  });
}
