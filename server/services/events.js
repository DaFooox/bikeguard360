'use strict';

const { EventEmitter } = require('events');

// In-process event bus used to push live updates to the dashboard (SSE).
const bus = new EventEmitter();
bus.setMaxListeners(0);

const publish = (userId, type, data) => bus.emit(`user:${userId}`, { type, data });

function subscribe(userId, listener) {
  bus.on(`user:${userId}`, listener);
  return () => bus.off(`user:${userId}`, listener);
}

module.exports = { publish, subscribe };
