/**
 * Stealth script injected via CDP Page.addScriptToEvaluateOnNewDocument
 * on every new page/tab. Patches common bot-detection vectors.
 *
 * Based on puppeteer-extra-plugin-stealth evasions.
 */

/**
 * Whether the stealth script should be injected at all.
 *
 * These shims exist for the case where this server launches Chromium itself
 * (managed-daemon mode). A Playwright-launched browser really does report
 * `navigator.webdriver === true`, an empty `navigator.plugins`, and no
 * `window.chrome`, so the shims move it back toward looking like normal Chrome.
 *
 * When the user attaches to their OWN already-running browser via
 * `--cdp-endpoint`, none of that holds: it is a real, vendor-signed Chrome with
 * a real profile that already reports honest values. Injecting there is
 * strictly worse than doing nothing:
 *
 *   - `navigator.webdriver` becomes `undefined`, a value no real Chrome ever
 *     returns (the honest answer is `false`) and a well-known signature of
 *     stealth patching.
 *   - A synthetic `chrome.runtime` appears on pages where real Chrome exposes
 *     none, carrying the exact key set of the puppeteer-extra evasions.
 *   - `Function.prototype.toString` and `Object.getOwnPropertyDescriptor` are
 *     replaced by JS functions whose source any page can read back from a fresh
 *     realm, defeating the `[native code]` masking:
 *
 *       const f = document.createElement('iframe');
 *       document.body.appendChild(f);
 *       f.contentWindow.Function.prototype.toString.call(Function.prototype.toString);
 *       // => "function() { if (patchedFunctions.has(this)) { ... } }"
 *
 * That converts "an automated browser" into "a browser visibly trying to hide
 * that it is automated", which is a worse signal for the user's logged-in
 * accounts than injecting nothing.
 *
 * Defaults to `false` so a caller that never opts in never patches a real
 * browser. `runServer()` enables it for managed-daemon mode only.
 */
let stealthInjectionEnabled = false;

export function setStealthInjectionEnabled(enabled: boolean): void {
  stealthInjectionEnabled = enabled;
}

export function isStealthInjectionEnabled(): boolean {
  return stealthInjectionEnabled;
}

export const STEALTH_SCRIPT = `
(function() {
  'use strict';

  // 1. navigator.webdriver — belt and suspenders (flag handles it, but just in case)
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // 2. navigator.plugins — normal Chrome has plugins, automated doesn't
  const fakePlugins = {
    0: {
      0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: null },
      description: 'Portable Document Format',
      filename: 'internal-pdf-viewer',
      length: 1,
      name: 'Chrome PDF Plugin',
    },
    1: {
      0: { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: null },
      description: '',
      filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
      length: 1,
      name: 'Chrome PDF Viewer',
    },
    2: {
      0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable', enabledPlugin: null },
      1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable', enabledPlugin: null },
      description: '',
      filename: 'internal-nacl-plugin',
      length: 2,
      name: 'Native Client',
    },
    length: 3,
  };

  if (navigator.plugins.length === 0) {
    Object.defineProperty(navigator, 'plugins', {
      get: () => fakePlugins,
      configurable: true,
    });
  }

  // 3. navigator.languages — ensure realistic value
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  }

  // 4. window.chrome — must exist with runtime property
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      connect: function() { return { onDisconnect: { addListener: function() {} } }; },
      sendMessage: function() {},
    };
  }

  // 5. navigator.permissions — patch Notification permission query
  const originalQuery = window.Permissions?.prototype?.query;
  if (originalQuery) {
    window.Permissions.prototype.query = function(parameters) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return originalQuery.call(this, parameters);
    };
  }

  // 6. Remove CDP artifacts — some detectors check for these
  delete window.__cdp_binding__;

  // Clean up getter artifacts from Error.stack
  const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = function(obj, prop) {
    if (prop === 'webdriver' && obj === navigator) {
      return undefined;
    }
    return originalGetOwnPropertyDescriptor.call(this, obj, prop);
  };

  // 7. iframe contentWindow — automated Chrome leaks through cross-origin iframe checks
  try {
    const originalAttachShadow = Element.prototype.attachShadow;
    if (originalAttachShadow) {
      Element.prototype.attachShadow = function() {
        return originalAttachShadow.apply(this, arguments);
      };
    }
  } catch (_) {}

  // 8. console.debug — some detectors use toString() on native functions
  // Ensure our patched functions look native
  const nativeToString = Function.prototype.toString;
  const patchedFunctions = new Map();

  function makeNativeString(fn, nativeName) {
    patchedFunctions.set(fn, \`function \${nativeName || fn.name || ''}() { [native code] }\`);
  }

  Function.prototype.toString = function() {
    if (patchedFunctions.has(this)) {
      return patchedFunctions.get(this);
    }
    return nativeToString.call(this);
  };

  makeNativeString(Function.prototype.toString, 'toString');
  if (window.Permissions?.prototype?.query !== originalQuery) {
    makeNativeString(window.Permissions.prototype.query, 'query');
  }
  makeNativeString(Object.getOwnPropertyDescriptor, 'getOwnPropertyDescriptor');

})();
`;
