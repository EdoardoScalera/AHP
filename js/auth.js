const Auth = (() => {
  let onUnlock = null;
  let storageRef = null;

  function init(config, callback, storage) {
    onUnlock = callback;
    storageRef = storage || null;
    attachEventListeners();
  }

  function setStorage(storage) {
    storageRef = storage;
  }

  async function getStorage() {
    if (storageRef) return storageRef;
    const mod = await import('./storage.js');
    return mod.Storage;
  }

  function attachEventListeners() {
    // No password screen — the survey is public. The unlock callback is
    // invoked immediately on init so the start screen shows directly.
    if (onUnlock) onUnlock();
  }

  function getPassword() {
    return null; // no access code anymore
  }

  function getAccessCode() {
    return null; // no access code anymore
  }

  function clearPassword() {
    // nothing to clear
  }

  return { init, setStorage, getPassword, getAccessCode, clearPassword };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
}

export { Auth };
