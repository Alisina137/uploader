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
