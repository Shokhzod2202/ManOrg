import { describe, expect, it } from 'vitest';
import { notificationTarget, parseMessage, sameSite } from './bridge';

const WEB = 'https://app.haydar.example';

describe('phone app bridge', () => {
  it('takes a session only from our own site, and only for our own API', () => {
    const token = 'r'.repeat(40);
    const msg = JSON.stringify({
      type: 'session',
      refreshToken: token,
      orgId: 'org-1',
      origin: 'https://evil.example',
    });
    expect(parseMessage(msg, `${WEB}/app`, WEB)).toEqual({
      type: 'session',
      refreshToken: token,
      orgId: 'org-1',
      origin: WEB,
    });
    expect(parseMessage(msg, 'https://evil.example/app', WEB)).toBeNull();
    expect(parseMessage(msg, 'https://app.haydar.example.evil.example/', WEB)).toBeNull();
  });

  it('ignores malformed messages', () => {
    expect(parseMessage('not json', WEB, WEB)).toBeNull();
    expect(
      parseMessage(JSON.stringify({ type: 'session', refreshToken: 'short' }), WEB, WEB),
    ).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'launch-missiles' }), WEB, WEB)).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'signed-out' }), WEB, WEB)).toEqual({
      type: 'signed-out',
    });
    expect(parseMessage(JSON.stringify({ type: 'org', orgId: 7 }), WEB, WEB)).toEqual({
      type: 'org',
      orgId: null,
    });
  });

  it('opens notifications only inside the app', () => {
    expect(notificationTarget(WEB, { url: '/app/tasks' })).toBe(`${WEB}/app/tasks`);
    expect(notificationTarget(WEB, { url: 'https://evil.example' })).toBe(`${WEB}/app`);
    expect(notificationTarget(WEB, { url: '//evil.example/x' })).toBe(`${WEB}/app`);
    expect(notificationTarget(WEB, null)).toBe(`${WEB}/app`);
  });

  it('compares whole origins', () => {
    expect(sameSite('http://localhost:3000/app', 'http://localhost:3000')).toBe(true);
    expect(sameSite('http://localhost:3001/app', 'http://localhost:3000')).toBe(false);
    expect(sameSite('not a url', WEB)).toBe(false);
  });
});
