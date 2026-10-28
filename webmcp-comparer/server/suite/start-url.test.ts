import { describe, expect, it } from 'vitest';
import { resolveStartUrl } from './start-url.ts';

describe('resolveStartUrl', () => {
  it('uses the Site URL when the Scenario has no path', () => {
    expect(resolveStartUrl('http://localhost:4000', {})).toBe('http://localhost:4000/');
    expect(resolveStartUrl('http://localhost:4000/shop?x=1', {})).toBe(
      'http://localhost:4000/shop?x=1',
    );
  });

  it('appends the path to the Site URL', () => {
    expect(resolveStartUrl('http://localhost:4000', { path: '/products/blue-sneakers' })).toBe(
      'http://localhost:4000/products/blue-sneakers',
    );
    expect(resolveStartUrl('http://localhost:4000/', { path: '/cart' })).toBe(
      'http://localhost:4000/cart',
    );
  });

  it('keeps the Site URL path prefix and the path query', () => {
    expect(resolveStartUrl('https://example.com/shop/', { path: '/search?q=red#top' })).toBe(
      'https://example.com/shop/search?q=red#top',
    );
  });

  it('stays on the Site URL origin', () => {
    expect(resolveStartUrl('http://localhost:4000', { path: '//evil.example/x' })).toBe(
      'http://localhost:4000//evil.example/x',
    );
  });

  it('rejects an invalid Site URL', () => {
    expect(() => resolveStartUrl('localhost:4000', {})).toThrow('http:// or https://');
    expect(() => resolveStartUrl('not a url', {})).toThrow('not a valid URL');
  });
});
