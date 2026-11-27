const zoneInput = document.querySelector('[data-browser-zone]');
if (zoneInput) zoneInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

document.querySelector('[data-focus]')?.focus();

const account = document.querySelector('.account');
if (account) {
  document.addEventListener('click', (event) => {
    if (!account.contains(event.target)) account.open = false;
  });
  account.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !account.open) return;
    account.open = false;
    account.querySelector('summary').focus();
  });
}

const toast = document.querySelector('.notice.success');
if (toast) {
  setTimeout(() => {
    if (document.activeElement === toast) document.querySelector('.settings-form .primary').focus();
    toast.remove();
  }, 4000);
}

if (document.querySelector('[data-account-refresh]')) {
  let left = false;
  window.addEventListener('blur', () => { left = true; });
  window.addEventListener('focus', () => { if (left) location.replace(location.pathname); });
}
if (location.pathname === '/activity') {
  setTimeout(() => { if (!document.hidden && document.activeElement === document.body) location.reload(); }, 30000);
}
