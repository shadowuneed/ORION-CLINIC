import { describe, expect, it } from 'vitest';
import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
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
      '/signin-with-chatgpt?return_to=%2F',
    );
  });
});
