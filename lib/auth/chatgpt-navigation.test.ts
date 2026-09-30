import { describe, expect, it } from 'vitest';
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  chatGPTProviderSignInPath,
} from './chatgpt-navigation';

describe('ChatGPT auth navigation', () => {
  it('ends logout on a public page instead of restarting protected-page sign-in', () => {
    expect(chatGPTSignOutPath()).toBe('/signout-with-chatgpt?return_to=%2Fsigned-out');
  });
  it('preserves only a relative application return path', () => {
    expect(chatGPTSignOutPath('/patients?status=active#list')).toBe(
      '/signout-with-chatgpt?return_to=%2Fpatients%3Fstatus%3Dactive%23list',
    );
    expect(chatGPTSignInPath('/live?encounterId=enc-1')).toBe(
      '/sign-in?return_to=%2Flive%3FencounterId%3Denc-1',
    );
    expect(chatGPTProviderSignInPath('/live?encounterId=enc-1')).toBe(
      '/signin-with-chatgpt?return_to=%2Flive%3FencounterId%3Denc-1',
    );
  });

  it('fails closed for external and reserved auth destinations', () => {
    expect(chatGPTSignOutPath('https://example.com')).toBe(
      '/signout-with-chatgpt?return_to=%2F',
    );
    expect(chatGPTSignOutPath('//example.com')).toBe(
      '/signout-with-chatgpt?return_to=%2F',
    );
    expect(chatGPTSignOutPath('/callback?code=secret')).toBe(
      '/signout-with-chatgpt?return_to=%2F',
    );
    expect(chatGPTSignInPath('/signout-with-chatgpt')).toBe(
      '/sign-in?return_to=%2F',
    );
  });

  it.each([
    '/sign-in', '/sign-in/', '/sign-in?return_to=%2Flive',
    '/signin-with-chatgpt', '/signin-with-chatgpt/',
    '/signout-with-chatgpt', '/callback', '/callback/',
    '/%73ign-in', '/%2573ign-in',
    '/workspace/../sign-in', '/workspace/%2e%2e/sign-in',
  ])('does not recurse through an auth return destination: %s', returnTo => {
    expect(chatGPTSignInPath(returnTo)).toBe('/sign-in?return_to=%2F');
    expect(chatGPTProviderSignInPath(returnTo)).toBe('/signin-with-chatgpt?return_to=%2F');
    expect(chatGPTSignOutPath(returnTo)).toBe('/signout-with-chatgpt?return_to=%2F');
  });

  it.each(['/signed-out', '/signed-out/', '/signed-out?status=done', '/%73igned-out'])('permits the public exit destination only after logout: %s', returnTo => {
    expect(chatGPTSignInPath(returnTo)).toBe('/sign-in?return_to=%2F');
    expect(chatGPTProviderSignInPath(returnTo)).toBe('/signin-with-chatgpt?return_to=%2F');
    expect(chatGPTSignOutPath(returnTo)).toBe(`/signout-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`);
  });

  it.each([
    'https://outside.test', '//outside.test', '/\\outside.test',
    '/%2foutside.test', '/%2f%2foutside.test', '/%5coutside.test',
    '/%255c%255coutside.test', '/patients/%0a/sign-in', '/%00sign-in',
    '/patients\n', '/patients?search=x\r\nLocation: https://outside.test',
    '/patients\t', '/patients\u007f', '/%invalid',
  ])('rejects external, encoded or control-character redirect ambiguity: %s', returnTo => {
    expect(chatGPTSignInPath(returnTo)).toBe('/sign-in?return_to=%2F');
    expect(chatGPTProviderSignInPath(returnTo)).toBe('/signin-with-chatgpt?return_to=%2F');
    expect(chatGPTSignOutPath(returnTo)).toBe('/signout-with-chatgpt?return_to=%2F');
  });

  it('preserves ordinary encoded search text, exact workspace context and fragments through both login steps', () => {
    const returnTo = '/orders?facilityId=fac-a&accessAssignmentId=assignment-a&search=%D0%92%D1%80%D0%B0%D1%87#results';
    expect(chatGPTSignInPath(returnTo)).toBe(`/sign-in?return_to=${encodeURIComponent(returnTo)}`);
    expect(chatGPTProviderSignInPath(returnTo)).toBe(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`);
  });
});
