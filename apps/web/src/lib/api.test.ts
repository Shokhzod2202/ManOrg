import { afterEach, describe, expect, it } from 'vitest';
import { apiOrigin, apiV1 } from './api';

const original = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = original;
});

describe('api origin', () => {
  it('uses the local API when the variable is unset', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(apiOrigin()).toBe('http://localhost:3001');
    expect(apiV1()).toBe('http://localhost:3001/api/v1');
  });

  it('uses a same-origin path when the variable is empty', () => {
    process.env.NEXT_PUBLIC_API_URL = '';
    expect(apiOrigin()).toBe('');
    expect(apiV1()).toBe('/api/v1');
  });
});
