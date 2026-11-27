export const platforms = ['YouTube', 'Facebook', 'Instagram', 'TikTok'];
export const formats = ['Short', 'Long'];
export const visibilities = ['Public', 'Unlisted', 'Private'];
export const pageSize = 25;
export const maxFileSize = 2 * 1024 ** 3;
export const chunkSize = 512 * 1024;
export const maxThumbnailSize = 2_000_000;

export function eligiblePlatforms(format) {
  return format === 'Short' ? platforms : platforms.slice(0, 2);
}

export function suggestedFormat({ width, height, duration }) {
  return height > width && duration <= 180 ? 'Short' : 'Long';
}

export class InputError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

export function channelName(value) {
  const name = String(value || '').trim().normalize('NFC');
  if (name.length < 2 || name.length > 40 || /[\p{Cc}]/u.test(name)) {
    throw new InputError('Enter a folder name between 2 and 40 characters.');
  }
  return name;
}

const field = (form, name) => (form.get(name) || '').trim();
const chips = (value) => [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];

function commonMetadata(form) {
  const values = {
    description: field(form, 'description'),
    hashtags: chips(field(form, 'hashtags')),
    tags: chips(field(form, 'tags')),
    visibility: field(form, 'visibility')
  };
  if (values.description.length > 5000) throw new InputError('The description can contain up to 5,000 characters.');
  if (values.hashtags.length > 30 || values.hashtags.some((tag) => !/^#?[\p{L}\p{N}_]+$/u.test(tag) || tag.length > 100)) {
    throw new InputError('Enter up to 30 comma-separated hashtags using letters, numbers, or underscores.');
  }
  values.hashtags = [...new Set(values.hashtags.map((tag) => '#' + tag.replace(/^#/, '')))];
  if (values.tags.join(',').length > 500) throw new InputError('YouTube tags can contain up to 500 characters combined.');
  if (!visibilities.includes(values.visibility)) throw new InputError('Choose a visibility.');
  return values;
}

export function defaultsFrom(form) {
  const metadata = commonMetadata(form);
  const captionFooters = Object.fromEntries(platforms.map((platform) => [platform, field(form, platform)]));
  const preferredTime = field(form, 'preferredTime');
  if (Object.values(captionFooters).some((footer) => footer.length > 2000)) {
    throw new InputError('Each platform footer can contain up to 2,000 characters.');
  }
  if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) throw new InputError('Enter a valid time.');
  return { ...metadata, captionFooters, preferredTime };
}

export function videoDetailsFrom(form, video) {
  const title = field(form, 'title');
  const format = field(form, 'format');
  if (!title || title.length > 100) throw new InputError('Enter a title between 1 and 100 characters.');
  if (!formats.includes(format)) throw new InputError('Choose Short or Long.');
  return { title, format, metadata: { ...video.metadata, ...commonMetadata(form) } };
}

export function initialMetadata(defaults) {
  return { description: '', hashtags: [], tags: [], visibility: 'Public', captionFooters: {}, preferredTime: '', ...defaults };
}
