export const timeZones = ['UTC', ...Intl.supportedValuesOf('timeZone')];
const selectableZones = new Set(timeZones);

export function normalizeTimeZone(value) {
  if (selectableZones.has(value)) return value;
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+/-]{0,99}$/.test(value)) return null;
  try {
    const canonical = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    if (selectableZones.has(canonical)) return canonical;
    return timeZones.find((zone) =>
      new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone === canonical
    ) || null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function validateProfile(name, email) {
  const errors = {};
  if (!name || name.length > 80) errors.name = 'Enter a name between 1 and 80 characters.';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}
