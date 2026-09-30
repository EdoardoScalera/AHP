const Auth = (() => {
  let passwordHash = '';
  let onUnlock = null;

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function init(config, callback) {
    passwordHash = config.passwordHash;
    onUnlock = callback;
    attachEventListeners();
  }

  function attachEventListeners() {
    const input = document.getElementById('password-input');
    const submitBtn = document.getElementById('password-submit');
    const errorEl = document.getElementById('password-error');

    const checkPassword = async () => {
      const password = input.value;
      if (!password) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Checking...';

      const hash = await sha256(password);
      if (hash === passwordHash) {
        errorEl.classList.add('hidden');
        input.value = '';
        if (onUnlock) onUnlock();
      } else {
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

  return { init };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
}

export { Auth };