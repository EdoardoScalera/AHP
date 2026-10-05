const Auth = (() => {
  let onUnlock = null;
  let currentCode = null;
  let storageRef = null;

  function init(config, callback, storage) {
    // config kept for signature compat; verification is server-side via Worker.
    onUnlock = callback;
    storageRef = storage || null;
    attachEventListeners();
  }

  // app.js passes Storage via setStorage; fallback: dynamic import to avoid cycles.
  function setStorage(storage) {
    storageRef = storage;
  }

  async function getStorage() {
    if (storageRef) return storageRef;
    const mod = await import('./storage.js');
    return mod.Storage;
  }

  function attachEventListeners() {
    const input = document.getElementById('password-input');
    const submitBtn = document.getElementById('password-submit');
    const errorEl = document.getElementById('password-error');

    const checkPassword = async () => {
      const code = input.value;
      if (!code) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Checking...';
      errorEl.classList.add('hidden');

      try {
        const storage = await getStorage();
        await storage.verifyAccessCode(code);
        currentCode = code;
        input.value = '';
        if (onUnlock) onUnlock();
      } catch (e) {
        errorEl.textContent = e.message || 'Incorrect password. Please try again.';
        errorEl.classList.remove('hidden');
        input.value = '';
        input.focus();
      }

      submitBtn.disabled = false;
      submitBtn.textContent = 'Unlock Survey';
    };

    submitBtn.addEventListener('click', checkPassword);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') checkPassword();
    });
  }

  function getPassword() {
    return currentCode;
  }

  function getAccessCode() {
    return currentCode;
  }

  function clearPassword() {
    currentCode = null;
  }

  return { init, setStorage, getPassword, getAccessCode, clearPassword };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
}

export { Auth };
