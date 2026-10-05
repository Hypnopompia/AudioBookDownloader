'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function on(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  info: () => call('app:info'),
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  openExternal: (url) => call('open:external', url),
  catalog: {
    sources: () => call('catalog:sources'),
    genres: () => call('catalog:genres'),
    load: (sourceId, force) => call('catalog:load', sourceId, force),
    details: (identifier, quality) => call('book:details', identifier, quality),
    onProgress: (cb) => on('catalog:progress', cb),
    onUpdated: (cb) => on('catalog:updated', cb),
  },
  drives: {
    list: () => call('drives:list'),
    pickFolder: () => call('drives:pickFolder'),
    space: (mount) => call('drives:space', mount),
    eject: (mount) => call('drives:eject', mount),
    onChange: (cb) => on('drives:changed', cb),
  },
  card: {
    list: (mount) => call('card:list', mount),
    remove: (mount, folder) => call('card:delete', mount, folder),
    removeFile: (mount, name) => call('card:deleteFile', mount, name),
    fixOrder: (mount) => call('card:fixOrder', mount),
    reveal: (mount, folder) => call('card:reveal', mount, folder),
    onChanged: (cb) => on('card:changed', cb),
    onEjected: (cb) => on('card:ejected', cb),
    onFixProgress: (cb) => on('card:fixProgress', cb),
    verify: (mount, folders) => call('card:verify', mount, folders),
    cancelVerify: () => call('card:verifyCancel'),
    onVerifyProgress: (cb) => on('card:verifyProgress', cb),
  },
  downloads: {
    state: () => call('downloads:state'),
    add: (opts) => call('downloads:add', opts),
    cancel: (id) => call('downloads:cancel', id),
    retry: (id) => call('downloads:retry', id),
    clear: () => call('downloads:clear'),
    setAutoEject: (v) => call('downloads:setAutoEject', v),
    onChange: (cb) => on('downloads:changed', cb),
  },
  library: {
    state: () => call('library:state'),
    update: (key, patch) => call('library:update', key, patch),
    onChange: (cb) => on('library:changed', cb),
  },
  local: {
    list: () => call('local:list'),
    remove: (dir) => call('local:delete', dir),
    removeAll: () => call('local:deleteAll'),
    reveal: (dir) => call('local:reveal', dir),
    onChange: (cb) => on('local:changed', cb),
  },
  player: {
    open: (source) => call('player:open', source),
  },
  updates: {
    status: () => call('update:status'),
    check: () => call('update:check'),
    install: () => call('update:install'),
    onChange: (cb) => on('update:changed', cb),
  },
  onNotice: (cb) => on('app:notice', cb),
});
