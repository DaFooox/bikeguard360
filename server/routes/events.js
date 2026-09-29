'use strict';

const events = require('../services/events');

// Server-Sent Events stream for live dashboard updates
module.exports = () => (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const unsubscribe = events.subscribe(req.user.id, ({ type, data }) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
};
