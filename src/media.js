import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chunkSize, InputError, maxThumbnailSize } from './draft-model.js';

const run = promisify(execFile);
const videoInput = ['-protocol_whitelist', 'file', '-f', 'mov'];
const mediaKey = /^[a-f\d-]{36}$/;
const expiry = 7 * 24 * 60 * 60 * 1000;

export function mediaStorage(root, store) {
  const filename = (key) => {
    if (!mediaKey.test(key)) throw new Error('Invalid media key');
    return join(root, key);
  };
  const locks = new Set();
  return {
    clean() {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      store.expireUploads(Date.now() - expiry);
      const referenced = new Set(store.referencedMedia().map(({ key }) => key));
      for (const key of readdirSync(root)) {
        if (mediaKey.test(key) && !referenced.has(key)) this.removeUnused(key);
      }
    },
    removeUnused(key) {
      if (store.referencesMedia(key)) return;
      try {
        unlinkSync(filename(key));
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not remove an unreferenced media file', error.code);
      }
    },
    offset(key) {
      try {
        return statSync(filename(key)).size;
      } catch (error) {
        if (error.code === 'ENOENT') return 0;
        throw error;
      }
    },
    append(upload, offset, data) {
      if (locks.has(upload.id)) throw new InputError('The upload is being verified.', 409);
      if (this.offset(upload.id) !== offset) throw new InputError('The upload offset changed. Resume the upload to continue.', 409);
      if (!data.length || data.length > chunkSize || offset + data.length > upload.size) {
        throw new InputError('The upload chunk is too large.', 413);
      }
      mkdirSync(root, { recursive: true, mode: 0o700 });
      appendFileSync(filename(upload.id), data, { mode: 0o600 });
      return offset + data.length;
    },
    async finalize(upload, complete) {
      if (locks.has(upload.id)) throw new InputError('The upload is already being verified.', 409);
      if (this.offset(upload.id) !== upload.size) throw new InputError('Finish transferring the file first.', 409);
      locks.add(upload.id);
      try {
        const path = filename(upload.id);
        const info = await probe(videoInput, path);
        const video = info.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
        const duration = Number(info.format?.duration ?? video?.duration);
        if (!video?.width || !video?.height || !Number.isFinite(duration) || duration <= 0) {
          throw new InputError('This file has no readable video stream.');
        }
        const rotation = Number(video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation || 0);
        const [width, height] = Math.abs(rotation % 180) === 90 ? [video.height, video.width] : [video.width, video.height];
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        return complete({ width, height, duration, hash: hash.digest('hex') });
      } finally {
        locks.delete(upload.id);
        this.removeUnused(upload.id);
      }
    },
    stream(video, request, response) {
      const path = filename(video.media_key);
      const size = this.offset(video.media_key);
      if (!size) throw new InputError('The source video is unavailable.', 404);
      const headers = {
        'Content-Type': /\.mov$/i.test(video.filename) ? 'video/quicktime' : 'video/mp4',
        'Accept-Ranges': 'bytes'
      };
      const range = request.headers.range;
      const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      const suffix = match && !match[1] && match[2];
      const start = suffix ? Math.max(0, size - Number(suffix)) : Number(match?.[1] || 0);
      const end = !suffix && match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if ((range && !(match?.[1] || match?.[2])) || start >= size || end < start) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return response.end();
      }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      response.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(path, { start, end });
      response.on('close', () => stream.destroy());
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    },
    async frame(video, seconds) {
      const [width, height] = video.format === 'Short' ? [720, 1280] : [1280, 720];
      const { stdout: data } = await mediaCommand('ffmpeg', [
        '-nostdin', '-v', 'error', '-ss', String(seconds), ...videoInput, '-i', filename(video.media_key),
        '-map', '0:V:0', '-frames:v', '1', '-an', '-threads', '1',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`,
        '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
      ], { encoding: 'buffer', maxBuffer: maxThumbnailSize });
      if (!data.length) throw new InputError('No frame was found at that time. Try an earlier frame.');
      return { data, mime: 'image/jpeg', format: video.format };
    }
  };
}

async function mediaCommand(executable, args, { input, ...options }) {
  try {
    const result = run(executable, args, { timeout: 25_000, windowsHide: true, ...options });
    if (input) {
      result.child.stdin.on('error', () => {});
      result.child.stdin.end(input);
    }
    return await result;
  } catch (error) {
    if (error.code === 'ENOENT') throw new InputError('Install FFmpeg and restart Upload Hub to process media.', 503);
    throw new InputError('The media could not be read. Check the format and try again.');
  }
}

async function probe(input, path, data) {
  const args = [...input, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path];
  return JSON.parse((await mediaCommand('ffprobe', args, { maxBuffer: 256_000, input: data })).stdout);
}

export async function thumbnailFrom(data, format) {
  if (!data.length || data.length > maxThumbnailSize) throw new InputError('Choose a JPG or PNG under 2 MB.');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const type = data.subarray(0, 8).equals(png) ? 'png'
    : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'jpeg' : null;
  if (!type) throw new InputError('Choose a JPG or PNG image.');
  const { streams } = await probe(['-protocol_whitelist', 'pipe', '-f', type === 'jpeg' ? 'jpeg_pipe' : 'png_pipe'], 'pipe:0', data);
  const { width, height } = streams?.[0] || {};
  const [x, y] = format === 'Short' ? [9, 16] : [16, 9];
  if (!width || !height || width > 8192 || height > 8192 || Math.abs(width * y - height * x) >= Math.max(x, y)) {
    throw new InputError(`Use a ${x}:${y} thumbnail at up to 8,192 pixels per side.`);
  }
  return { data, mime: `image/${type}`, format };
}
