import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDownloadAccepted, DOCKER_DESKTOP_INSTALLER, serverDownloadOffer } from '../dist/downloads.js';

test('a download does not start until that id was accepted', () => {
  const offer = serverDownloadOffer('minecraft', 'paper', '26.3');
  assert.equal(offer.id, 'server');
  assert.throws(() => assertDownloadAccepted({}, [offer]), /Confirm the download/);
  assert.doesNotThrow(() => assertDownloadAccepted({ acceptDownloads: ['server'] }, [offer]));
});

test('the Docker installer is the official Windows package', () => {
  const url = new URL(DOCKER_DESKTOP_INSTALLER);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'desktop.docker.com');
  assert.match(url.pathname, /Docker%20Desktop%20Installer\.exe$/);
});
