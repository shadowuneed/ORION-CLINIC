const SIGN_IN_PATH = '/sign-in';
const PROVIDER_SIGN_IN_PATH = '/signin-with-chatgpt';
const SIGN_OUT_PATH = '/signout-with-chatgpt';
const SIGNED_OUT_PATH = '/signed-out';
const CALLBACK_PATH = '/callback';
const RETURN_ORIGIN = 'https://app.local';
const unsafePathCharacters = /[\\\u0000-\u001f\u007f]/u;

export function chatGPTSignInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(
    safeRelativeReturnPath(returnTo),
  )}`;
}

/** Explicit full-page provider action; ordinary login links go to the public screen. */
export function chatGPTProviderSignInPath(returnTo: string): string {
  return `${PROVIDER_SIGN_IN_PATH}?return_to=${encodeURIComponent(
    safeRelativeReturnPath(returnTo),
  )}`;
}

export function chatGPTSignOutPath(returnTo = SIGNED_OUT_PATH): string {
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(
    safeRelativeReturnPath(returnTo, true),
  )}`;
}

function safeRelativeReturnPath(value: string, allowSignedOut = false): string {
  if (!value.startsWith('/') || value.startsWith('//') || unsafePathCharacters.test(value)) return '/';

  let url: URL;
  try {
    url = new URL(value, RETURN_ORIGIN);
    if (url.origin !== RETURN_ORIGIN) return '/';

    // Check the decoded route too: a router may normalize encoded separators,
    // dot segments or a trailing slash before resolving an authentication page.
    const decodedPath = decodeURIComponent(url.pathname);
    if (unsafePathCharacters.test(decodedPath) || decodedPath.startsWith('//') ||
      /%[a-f0-9]{2}/i.test(decodedPath)) return '/';
    const normalized = new URL(decodedPath, RETURN_ORIGIN);
    if (normalized.origin !== RETURN_ORIGIN) return '/';
    const pathname = normalized.pathname.replace(/\/+$/, '') || '/';
    if (isReservedAuthPath(pathname) || (!allowSignedOut && pathname === SIGNED_OUT_PATH)) return '/';
  } catch {
    return '/';
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === PROVIDER_SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}
