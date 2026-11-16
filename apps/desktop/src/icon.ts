import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeImage, type NativeImage } from 'electron';

const markPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'brand-mark.png');

export function appIcon(): NativeImage {
  return nativeImage.createFromPath(markPath);
}

export function trayIcon(): NativeImage {
  return appIcon().resize({ width: 32, height: 32 });
}
